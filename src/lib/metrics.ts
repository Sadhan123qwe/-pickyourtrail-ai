import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Lightweight, in-process performance metrics (single server instance).
 * - Per-request timing and database time via AsyncLocalStorage.
 * - Rolling window of the last N samples per route for p50/p95/p99.
 * - Cache hit/miss counters.
 * Nothing here records request bodies, customer data or secrets.
 */

interface RequestStore {
  dbMs: number;
  dbCount: number;
}

const als = new AsyncLocalStorage<RequestStore>();
const WINDOW = 500;

interface RouteStats {
  durations: number[];
  dbMs: number[];
  dbCounts: number[];
  count: number;
  errors: number; // 5xx
  clientErrors: number; // 4xx
  timeouts: number;
}

interface MetricsState {
  routes: Map<string, RouteStats>;
  cache: Map<string, { hits: number; misses: number }>;
  startedAt: string;
}

const g = globalThis as unknown as { __pytMetrics?: MetricsState };
function state(): MetricsState {
  g.__pytMetrics ??= { routes: new Map(), cache: new Map(), startedAt: new Date().toISOString() };
  return g.__pytMetrics;
}

export function runWithRequestMetrics<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ dbMs: 0, dbCount: 0 }, fn);
}

export function currentRequestMetrics(): RequestStore | undefined {
  return als.getStore();
}

/** Called by the database adapter around every statement. */
export function recordDbTime(ms: number) {
  const s = als.getStore();
  if (s) {
    s.dbMs += ms;
    s.dbCount++;
  }
}

export function recordCache(name: string, hit: boolean) {
  const c = state().cache.get(name) ?? { hits: 0, misses: 0 };
  if (hit) c.hits++;
  else c.misses++;
  state().cache.set(name, c);
}

/** Collapses ids in paths so metrics group by route, e.g. /api/trips/:id/itinerary. */
export function routeKey(method: string, pathname: string): string {
  const path = pathname
    .split("/")
    .map((seg) => (/^[a-z]{2,8}_[A-Za-z0-9_-]{6,}$/.test(seg) || /^PYT-\d+$/i.test(seg) || /^(user|guest)(:|%3A)/i.test(seg) || /^\d+$/.test(seg) ? ":id" : seg))
    .join("/");
  return `${method} ${path}`;
}

export function recordRequest(key: string, ms: number, status: number, store?: RequestStore, timedOut = false) {
  const routes = state().routes;
  const r = routes.get(key) ?? { durations: [], dbMs: [], dbCounts: [], count: 0, errors: 0, clientErrors: 0, timeouts: 0 };
  push(r.durations, ms);
  push(r.dbMs, store?.dbMs ?? 0);
  push(r.dbCounts, store?.dbCount ?? 0);
  r.count++;
  if (status >= 500) r.errors++;
  else if (status >= 400) r.clientErrors++;
  if (timedOut) r.timeouts++;
  routes.set(key, r);
}

function push(arr: number[], v: number) {
  arr.push(v);
  if (arr.length > WINDOW) arr.shift();
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 10) / 10;
}

const avg = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : 0);

export function metricsSnapshot() {
  const s = state();
  const routes = [...s.routes.entries()]
    .map(([route, r]) => ({
      route,
      count: r.count,
      p50: percentile(r.durations, 50),
      p95: percentile(r.durations, 95),
      p99: percentile(r.durations, 99),
      avgDbMs: avg(r.dbMs),
      p95DbMs: percentile(r.dbMs, 95),
      avgQueries: avg(r.dbCounts),
      errorRate: r.count ? Math.round((r.errors / r.count) * 1000) / 10 : 0,
      clientErrorRate: r.count ? Math.round((r.clientErrors / r.count) * 1000) / 10 : 0,
      timeouts: r.timeouts,
    }))
    .sort((a, b) => b.p95 - a.p95);
  const cache = [...s.cache.entries()].map(([name, c]) => ({ name, ...c, hitRate: c.hits + c.misses ? Math.round((c.hits / (c.hits + c.misses)) * 1000) / 10 : 0 }));
  return { since: s.startedAt, windowPerRoute: WINDOW, routes, cache };
}

export function resetMetrics() {
  g.__pytMetrics = undefined;
}
