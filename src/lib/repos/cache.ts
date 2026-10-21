import "server-only";
import { createHash } from "node:crypto";
import { get, nowIso, run } from "@/lib/db";
import { recordCache } from "@/lib/metrics";

/**
 * Shared response cache for NON-PERSONAL content only (e.g. answers to general
 * FAQ questions grounded in public documents). Never store customer-specific
 * data here: keys and values are visible to every user who asks the same thing.
 */
export function cacheKey(namespace: string, parts: unknown[]): string {
  return `${namespace}:${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40)}`;
}

export function cacheGet<T>(key: string): T | undefined {
  const ns = key.split(":")[0];
  const row = get<{ value_json: string; expires_at: string }>("SELECT value_json, expires_at FROM response_cache WHERE key = ?", [key]);
  if (!row || row.expires_at < nowIso()) {
    if (row) run("DELETE FROM response_cache WHERE key = ?", [key]);
    recordCache(ns, false);
    return undefined;
  }
  try {
    const value = JSON.parse(row.value_json) as T;
    recordCache(ns, true);
    return value;
  } catch {
    recordCache(ns, false);
    return undefined;
  }
}

export function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  const now = nowIso();
  run(
    "INSERT INTO response_cache (key, value_json, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, created_at = excluded.created_at, expires_at = excluded.expires_at",
    [key, JSON.stringify(value), now, new Date(Date.now() + ttlSeconds * 1000).toISOString()],
  );
}
