/**
 * In-memory sliding-window rate limiter. Suitable for a single server
 * instance (this demo); a multi-instance deployment should use a shared store
 * such as Redis behind the same interface.
 */

export const RATE_LIMITS = {
  ai: { limit: 20, windowMs: 60_000 },
  auth: { limit: 10, windowMs: 60_000 },
  write: { limit: 60, windowMs: 60_000 },
  read: { limit: 300, windowMs: 60_000 },
} as const;
export type RateBucket = keyof typeof RATE_LIMITS;

const hits = new Map<string, number[]>();

export function checkRateLimit(bucket: RateBucket, keys: string[], now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  const { limit: base, windowMs } = RATE_LIMITS[bucket];
  // Load-testing only (scripts/bench.mjs): RATE_LIMIT_MULTIPLIER raises every limit. Unset = normal limits.
  const limit = base * Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER) || 1);
  let retryAfter = 0;
  const windows = keys.map((k) => {
    const key = `${bucket}:${k}`;
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= limit) retryAfter = Math.max(retryAfter, Math.ceil((windowMs - (now - list[0])) / 1000));
    return { key, list };
  });
  if (retryAfter > 0) return { allowed: false, retryAfterSeconds: retryAfter };
  for (const { key, list } of windows) {
    list.push(now);
    hits.set(key, list);
  }
  if (hits.size > 50_000) hits.clear(); // crude memory bound
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  hits.clear();
}
