import "server-only";
import { all, get, newId, nowIso, run } from "@/lib/db";

/** Admin-configurable AI guard rails, stored in `app_settings`. */
export interface AiSettings {
  monthlyBudgetUsd: number;
  dailyRequestsPerActor: number;
  liveAiEnabled: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  monthlyBudgetUsd: 5,
  dailyRequestsPerActor: 60,
  liveAiEnabled: true,
};

export function getAiSettings(): AiSettings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM app_settings WHERE key LIKE 'ai.%'");
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = Number(map.get(k));
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return {
    monthlyBudgetUsd: num("ai.monthlyBudgetUsd", DEFAULT_AI_SETTINGS.monthlyBudgetUsd),
    dailyRequestsPerActor: num("ai.dailyRequestsPerActor", DEFAULT_AI_SETTINGS.dailyRequestsPerActor),
    liveAiEnabled: (map.get("ai.liveAiEnabled") ?? "true") === "true",
  };
}

export function updateAiSettings(patch: Partial<AiSettings>): AiSettings {
  const now = nowIso();
  const entries: [string, string][] = [];
  if (patch.monthlyBudgetUsd !== undefined) entries.push(["ai.monthlyBudgetUsd", String(patch.monthlyBudgetUsd)]);
  if (patch.dailyRequestsPerActor !== undefined) entries.push(["ai.dailyRequestsPerActor", String(patch.dailyRequestsPerActor)]);
  if (patch.liveAiEnabled !== undefined) entries.push(["ai.liveAiEnabled", String(patch.liveAiEnabled)]);
  for (const [key, value] of entries) {
    run(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [key, value, now],
    );
  }
  return getAiSettings();
}

export type UsageOutcome =
  | "ok" | "mock" | "cache_hit" | "fallback" | "error" | "rate_limited" | "budget_exceeded" | "limit_exceeded";

export interface UsageRecordInput {
  actorKey: string;
  category: string;
  provider: "openai" | "mock" | "cache";
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estCostUsd?: number;
  latencyMs?: number;
  outcome: UsageOutcome;
  errorCode?: string | null;
}

/** Records one AI request. Contains no prompt text, names or emails. */
export function recordUsage(r: UsageRecordInput) {
  run(
    `INSERT INTO usage_records (id, actor_key, category, provider, model, input_tokens, output_tokens, cached_tokens,
      est_cost_usd, latency_ms, outcome, error_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("use"), r.actorKey, r.category, r.provider, r.model ?? null, r.inputTokens ?? 0, r.outputTokens ?? 0,
      r.cachedTokens ?? 0, r.estCostUsd ?? 0, Math.round(r.latencyMs ?? 0), r.outcome, r.errorCode ?? null, nowIso(),
    ],
  );
}

function startOfMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function startOfDayIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function monthToDateSpendUsd(): number {
  return get<{ s: number | null }>("SELECT SUM(est_cost_usd) s FROM usage_records WHERE created_at >= ?", [startOfMonthIso()])?.s ?? 0;
}

export function actorRequestsToday(actorKey: string): number {
  return (
    get<{ c: number }>(
      "SELECT COUNT(*) c FROM usage_records WHERE actor_key = ? AND provider = 'openai' AND created_at >= ?",
      [actorKey, startOfDayIso()],
    )?.c ?? 0
  );
}

/** Returns why a live call must not be made, or null if it may proceed. */
export function checkLiveCallAllowed(actorKey: string, settings = getAiSettings()): "disabled" | "budget_exceeded" | "limit_exceeded" | null {
  if (!settings.liveAiEnabled) return "disabled";
  if (monthToDateSpendUsd() >= settings.monthlyBudgetUsd) return "budget_exceeded";
  if (actorRequestsToday(actorKey) >= settings.dailyRequestsPerActor) return "limit_exceeded";
  return null;
}

export interface UsageSummary {
  monthToDateUsd: number;
  requests: number;
  byCategory: { category: string; provider: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number; avgLatencyMs: number }[];
  byOutcome: { outcome: string; requests: number }[];
}

export function usageSummary(sinceIso: string): UsageSummary {
  const byCategory = all<UsageSummary["byCategory"][number]>(
    `SELECT category, provider, COUNT(*) requests, SUM(input_tokens) inputTokens, SUM(output_tokens) outputTokens,
            ROUND(SUM(est_cost_usd), 6) costUsd, CAST(AVG(latency_ms) AS INTEGER) avgLatencyMs
     FROM usage_records WHERE created_at >= ? GROUP BY category, provider ORDER BY requests DESC`,
    [sinceIso],
  );
  const byOutcome = all<{ outcome: string; requests: number }>(
    "SELECT outcome, COUNT(*) requests FROM usage_records WHERE created_at >= ? GROUP BY outcome ORDER BY requests DESC",
    [sinceIso],
  );
  return {
    monthToDateUsd: monthToDateSpendUsd(),
    requests: byCategory.reduce((s, r) => s + r.requests, 0),
    byCategory,
    byOutcome,
  };
}
