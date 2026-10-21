import { all } from "@/lib/db";
import { requirePermission, route } from "@/lib/http";
import { metricsSnapshot, percentile } from "@/lib/metrics";

/**
 * Measured performance for admins: API latency per route (p50/p95/p99), database
 * time and query counts, error/timeout rates, cache hit rates (since server start),
 * and AI call latency, outcomes, tokens and estimated cost (last 24 hours, from usage_records).
 */
export const GET = route({}, ({ actor }) => {
  requirePermission(actor, "settings:manage");
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = all<{ category: string; provider: string; latency_ms: number; outcome: string; input_tokens: number; output_tokens: number; cached_tokens: number; est_cost_usd: number }>(
    "SELECT category, provider, latency_ms, outcome, input_tokens, output_tokens, cached_tokens, est_cost_usd FROM usage_records WHERE created_at >= ?",
    [since],
  );
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(`${r.category}|${r.provider}`, [...(groups.get(`${r.category}|${r.provider}`) ?? []), r]);
  const ai = [...groups.entries()].map(([key, list]) => {
    const [category, provider] = key.split("|");
    const lat = list.map((r) => r.latency_ms);
    const failures = list.filter((r) => ["error", "fallback", "rate_limited", "budget_exceeded", "limit_exceeded"].includes(r.outcome)).length;
    return {
      category,
      provider,
      calls: list.length,
      p50LatencyMs: percentile(lat, 50),
      p95LatencyMs: percentile(lat, 95),
      failureRate: list.length ? Math.round((failures / list.length) * 1000) / 10 : 0,
      cacheHits: list.filter((r) => r.outcome === "cache_hit").length,
      inputTokens: list.reduce((s, r) => s + r.input_tokens, 0),
      outputTokens: list.reduce((s, r) => s + r.output_tokens, 0),
      cachedTokens: list.reduce((s, r) => s + r.cached_tokens, 0),
      estCostUsd: Math.round(list.reduce((s, r) => s + r.est_cost_usd, 0) * 10000) / 10000,
    };
  });
  return {
    ...metricsSnapshot(),
    ai,
    notes: [
      "API latency is measured inside the route handler (excludes network and Next.js routing overhead).",
      "AI latency is the full call duration; responses are not streamed, so first-response and full-response latency are the same.",
      "Metrics are kept in memory per server process and reset on restart.",
    ],
  };
});
