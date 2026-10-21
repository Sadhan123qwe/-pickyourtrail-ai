import "server-only";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { getDatabasePath } from "@/lib/config";
import { migrations } from "./schema";
import { seedIfEmpty } from "./seed";
import { recordDbTime } from "@/lib/metrics";

/**
 * Local persistence adapter: SQLite via Node's built-in `node:sqlite`.
 * The data lives in a file (default `data/pickyourtrail.db`) and survives
 * restarts. All access goes through the repositories in `src/lib/repos`, which
 * is the boundary to replace when moving to Supabase/PostgreSQL.
 */

type Params = Record<string, SQLInputValue> | SQLInputValue[];

interface DbState {
  db: DatabaseSync;
  path: string;
  txDepth: number;
  /** Prepared-statement cache: SQL text → compiled statement (bounded). */
  statements: Map<string, StatementSync>;
}

const globalForDb = globalThis as unknown as { __pytDb?: DbState };

function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return db;
}

function runMigrations(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as { id: string }[]).map((r) => r.id),
  );
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function state(): DbState {
  const path = getDatabasePath();
  const existing = globalForDb.__pytDb;
  if (existing && existing.path === path) return existing;
  if (existing) existing.db.close();
  const db = openDatabase(path);
  const next: DbState = { db, path, txDepth: 0, statements: new Map() };
  globalForDb.__pytDb = next;
  seedIfEmpty({ run, get, tx });
  return next;
}

export function rawDb(): DatabaseSync {
  return state().db;
}

const MAX_CACHED_STATEMENTS = 500;

/** Compiles each distinct SQL string once and reuses it (all SQL is static text with bound parameters). */
function prepare(sql: string): StatementSync {
  const s = state();
  let stmt = s.statements.get(sql);
  if (!stmt) {
    stmt = s.db.prepare(sql);
    if (s.statements.size >= MAX_CACHED_STATEMENTS) s.statements.delete(s.statements.keys().next().value!);
    s.statements.set(sql, stmt);
  }
  return stmt;
}

function bind(params?: Params): SQLInputValue[] | [Record<string, SQLInputValue>] {
  if (!params) return [];
  return Array.isArray(params) ? params : [params];
}

function timed<T>(fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    recordDbTime(performance.now() - t0);
  }
}

export function all<T>(sql: string, params?: Params): T[] {
  return timed(() => prepare(sql).all(...(bind(params) as SQLInputValue[])) as T[]);
}

export function get<T>(sql: string, params?: Params): T | undefined {
  return timed(() => prepare(sql).get(...(bind(params) as SQLInputValue[])) as T | undefined);
}

export function run(sql: string, params?: Params): { changes: number } {
  return timed(() => {
    const result = prepare(sql).run(...(bind(params) as SQLInputValue[]));
    return { changes: Number(result.changes) };
  });
}

/** Runs `fn` atomically. Nested calls use savepoints. */
export function tx<T>(fn: () => T): T {
  const s = state();
  const depth = s.txDepth;
  const savepoint = `sp_${depth}`;
  s.db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
  s.txDepth++;
  try {
    const result = fn();
    s.db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    s.db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}`);
    throw error;
  } finally {
    s.txDepth--;
  }
}

export interface DbApi {
  run: typeof run;
  get: typeof get;
  all: typeof all;
  tx: typeof tx;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Closes the connection (used by tests and the reset script). */
export function closeDb() {
  const existing = globalForDb.__pytDb;
  if (existing) {
    existing.db.close();
    globalForDb.__pytDb = undefined;
  }
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
