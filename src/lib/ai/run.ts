import "server-only";
import type { z } from "zod";
import { getAiConfig } from "@/lib/config";
import { estimateCostUsd } from "./pricing";
import { classifyError, describeError, getAiProvider } from "./provider";
import { checkLiveCallAllowed, recordUsage } from "./usage";

export type AiSource = "live" | "mock" | "fallback";

export interface AiOutcome<T> {
  value: T;
  source: AiSource;
  model: string | null;
  /** Safe, user-facing explanation when live AI was not used. */
  notice: string | null;
}

export interface RunStructuredOptions<T> {
  actorKey: string;
  category: "planner" | "itinerary" | "support" | "copilot";
  /** 'routine' uses the low-cost model; 'advanced' only where quality justifies it. */
  tier: "routine" | "advanced";
  system: string;
  input: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens?: number;
  /** Deterministic result used in mock mode and whenever the live call fails. */
  fallback: () => T;
}

const NOTICES: Record<string, string> = {
  disabled: "Live AI is switched off by an administrator, so the standard planner was used.",
  budget_exceeded: "This month's AI budget has been reached, so the standard planner was used.",
  limit_exceeded: "You've reached today's AI request limit, so the standard planner was used.",
  rate_limited: "The AI service is busy right now, so the standard planner was used.",
  quota_exhausted: "The AI service quota is exhausted, so the standard planner was used.",
  invalid_api_key: "The AI service rejected the configured API key, so the standard planner was used.",
  timeout: "The AI service took too long to respond, so the standard planner was used.",
  model_unavailable: "The configured AI model isn't available to this API project, so the standard planner was used.",
  permission_denied: "The AI service refused access for this API project, so the standard planner was used.",
  tls_untrusted_certificate: "The AI service couldn't be reached securely from this network, so the standard planner was used.",
  dns_error: "The AI service couldn't be reached from this network, so the standard planner was used.",
  connection_error: "The AI service couldn't be reached, so the standard planner was used.",
};

/**
 * Single entry point for structured AI calls. Enforces the admin budget and
 * per-actor limits, bounds output tokens, records usage, and falls back to a
 * deterministic result on any failure so the customer is never blocked.
 */
export async function runStructured<T>(opts: RunStructuredOptions<T>): Promise<AiOutcome<T>> {
  const config = getAiConfig();
  const provider = getAiProvider();

  if (!provider) {
    recordUsage({ actorKey: opts.actorKey, category: opts.category, provider: "mock", outcome: "mock" });
    return { value: opts.fallback(), source: "mock", model: null, notice: null };
  }

  const blocked = checkLiveCallAllowed(opts.actorKey);
  if (blocked) {
    recordUsage({
      actorKey: opts.actorKey,
      category: opts.category,
      provider: "mock",
      outcome: blocked === "disabled" ? "mock" : blocked,
      errorCode: blocked,
    });
    return { value: opts.fallback(), source: "fallback", model: null, notice: NOTICES[blocked] };
  }

  const model = opts.tier === "advanced" ? config.models.advanced : config.models.routine;
  const started = Date.now();
  try {
    const res = await provider.generateStructured({
      category: opts.category,
      model,
      system: opts.system,
      input: opts.input.slice(0, 12_000),
      schema: opts.schema,
      schemaName: opts.schemaName,
      maxOutputTokens: Math.min(opts.maxOutputTokens ?? config.limits.maxOutputTokens, config.limits.maxOutputTokens * 2),
    });
    recordUsage({
      actorKey: opts.actorKey,
      category: opts.category,
      provider: "openai",
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      cachedTokens: res.cachedTokens,
      estCostUsd: estimateCostUsd(res.model, res.inputTokens, res.outputTokens, res.cachedTokens),
      latencyMs: Date.now() - started,
      outcome: "ok",
    });
    return { value: res.value, source: "live", model: res.model, notice: null };
  } catch (error) {
    const { code, rateLimited } = classifyError(error);
    const usage = (error as { usage?: { inputTokens: number; outputTokens: number; cachedTokens: number } }).usage;
    recordUsage({
      actorKey: opts.actorKey,
      category: opts.category,
      provider: "openai",
      model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      cachedTokens: usage?.cachedTokens,
      estCostUsd: usage ? estimateCostUsd(model, usage.inputTokens, usage.outputTokens, usage.cachedTokens) : 0,
      latencyMs: Date.now() - started,
      outcome: rateLimited ? "rate_limited" : "fallback",
      errorCode: code,
    });
    // Log the category and error code only: never prompts, keys or personal data.
    const d = describeError(error);
    console.warn(
      `[ai] ${opts.category} call failed (${code}${d.status ? `, HTTP ${d.status}` : ""}${d.causeCode ? `, cause ${d.causeCode}` : ""}${d.requestId ? `, request ${d.requestId}` : ""}); using deterministic fallback`,
    );
    return {
      value: opts.fallback(),
      source: "fallback",
      model: null,
      notice: NOTICES[code] ?? "The AI service had a problem, so the standard planner was used.",
    };
  }
}

export function aiStatus() {
  const config = getAiConfig();
  return {
    mode: config.mode,
    reason: config.reason,
    routineModel: config.mode === "live" ? config.models.routine : null,
    advancedModel: config.mode === "live" ? config.models.advanced : null,
  };
}
