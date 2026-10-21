import "server-only";
import OpenAI from "openai";
import { getAiConfig } from "@/lib/config";
import { describeError, type ErrorDiagnostics } from "@/lib/ai/provider";
import { createVoiceClientSecret, VoiceSessionError } from "@/lib/ai/voice-session";
import { emptyProfile } from "@/lib/planner/profile";
import { extractTripPreferences } from "@/lib/services/planner";
import { trustSystemCertificates } from "@/lib/net/system-ca";
import { all } from "@/lib/db";

export type CheckStatus = "passed" | "failed" | "blocked";
export interface HealthCheck {
  name: string;
  status: CheckStatus;
  latencyMs: number | null;
  detail: string;
  /** Secret-free error fields: code, error class, HTTP status, request id, cause code, hint. */
  diagnostics?: ErrorDiagnostics;
}

const SAMPLE =
  "Plan a five-day family trip to Bali in December for two adults and two children aged six and nine. Our budget is 1.5 lakh rupees.";

const diagText = (d: ErrorDiagnostics) =>
  `${d.code} (${d.errorClass}${d.status ? `, HTTP ${d.status}` : ""}${d.causeCode ? `, cause ${d.causeCode}` : ""}${d.requestId ? `, request ${d.requestId}` : ""}). ${d.hint}`;

/**
 * Verifies the LIVE OpenAI integration end to end using the application's real
 * code paths: network/TLS reachability (no key sent), configuration, model
 * availability for this API project, one structured trip-planning request
 * (validated against our schema) and one Realtime voice client secret.
 * Never returns or logs the API key or the ephemeral secret.
 */
export async function runAiHealthCheck(actorKey = "system:ai-check"): Promise<{ mode: string; reason: string; models: Record<string, string>; systemCaTrusted: boolean; checks: HealthCheck[] }> {
  const config = getAiConfig();
  const models = { routine: config.models.routine, advanced: config.models.advanced, realtime: config.models.realtime, transcription: config.models.transcription };
  const systemCaTrusted = trustSystemCertificates();
  const checks: HealthCheck[] = [];
  const base = (config.baseURL ?? "https://api.openai.com/v1").replace(/\/$/, "");

  // 0. Network + TLS reachability without credentials: any HTTP answer (401 expected) proves the path works.
  {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(config.limits.timeoutMs) });
      checks.push({ name: "Network & TLS reachability", status: "passed", latencyMs: Date.now() - t0, detail: `Reached ${new URL(base).host} over HTTPS (HTTP ${res.status} without credentials, as expected). OS certificate store trusted: ${systemCaTrusted ? "yes" : "no"}.` });
    } catch (error) {
      const cause = ((error as { cause?: { code?: string } }).cause?.code ?? null) as string | null;
      const tls = !!cause && /CERT|SELF_SIGNED|ISSUER/.test(cause);
      checks.push({
        name: "Network & TLS reachability",
        status: "failed",
        latencyMs: Date.now() - t0,
        detail: tls
          ? `TLS certificate not trusted (cause ${cause}). This network intercepts HTTPS; the OS certificate store ${systemCaTrusted ? "is trusted but doesn't contain the proxy root" : "could not be loaded by this Node version"}. Start Node with --use-system-ca or set NODE_EXTRA_CA_CERTS.`
          : `Could not reach ${new URL(base).host}${cause ? ` (cause ${cause})` : ""}. Check DNS, firewall, proxy and OPENAI_BASE_URL.`,
      });
    }
  }

  const live = config.mode === "live" && !!config.apiKey;
  checks.push({
    name: "Configuration",
    status: live ? "passed" : "blocked",
    latencyMs: null,
    detail: live ? `Live mode. API key configured (value hidden). Base URL: ${config.baseURL ? "custom" : "api.openai.com"}.` : config.reason,
  });
  if (!live) {
    for (const name of ["Model availability", "Structured trip-planning request", "Realtime voice session"]) {
      checks.push({ name, status: "blocked", latencyMs: null, detail: "Blocked: no valid OPENAI_API_KEY is configured on the server." });
    }
    return { mode: config.mode, reason: config.reason, models, systemCaTrusted, checks };
  }

  // 1. Model availability for this API project (authenticated, minimal request).
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: config.limits.timeoutMs, maxRetries: 0 });
  for (const [role, id] of Object.entries(models)) {
    if (role === "advanced" && id === models.routine) continue;
    const t0 = Date.now();
    try {
      const m = await client.models.retrieve(id);
      checks.push({ name: `Model available: ${role}`, status: "passed", latencyMs: Date.now() - t0, detail: `${m.id} is available to this API project.` });
    } catch (error) {
      const d = describeError(error);
      checks.push({ name: `Model available: ${role}`, status: "failed", latencyMs: Date.now() - t0, detail: `${id}: ${diagText(d)}`, diagnostics: d });
    }
  }

  // 2. A real structured trip-planning request through the planner's extraction path.
  {
    const t0 = Date.now();
    const { extraction, source, notice } = await extractTripPreferences({ key: actorKey }, emptyProfile(), "destination", SAMPLE);
    const u = extraction.updates;
    const latest = all<{ input_tokens: number; output_tokens: number; est_cost_usd: number; model: string | null; error_code: string | null }>(
      "SELECT input_tokens, output_tokens, est_cost_usd, model, error_code FROM usage_records WHERE actor_key = ? AND category = 'planner' ORDER BY created_at DESC LIMIT 1",
      [actorKey],
    )[0];
    // The extractor returns the destination name; the planner engine maps it to the catalog id.
    const correct = (u.destinationId === "bali" || /bali/i.test(u.destinationName ?? "")) && u.durationDays === 5 && u.adults === 2 && u.children === 2;
    checks.push({
      name: "Structured trip-planning request",
      status: source === "live" && correct ? "passed" : "failed",
      latencyMs: Date.now() - t0,
      detail:
        source === "live"
          ? `Live response from ${latest?.model ?? models.routine}, schema-valid${correct ? " and correct (Bali, 5 days, 2 adults, 2 children)" : ` but incomplete: ${JSON.stringify({ destination: u.destinationId ?? u.destinationName, days: u.durationDays, adults: u.adults, children: u.children })}`}. Tokens in/out ${latest?.input_tokens ?? "?"}/${latest?.output_tokens ?? "?"}, est. $${(latest?.est_cost_usd ?? 0).toFixed(6)}.`
          : `Not live (${latest?.error_code ?? "fallback"}): ${notice ?? "fell back to the rules engine"}.`,
    });
  }

  // 3. A real Realtime voice client secret (ephemeral; not returned).
  {
    const t0 = Date.now();
    try {
      const s = await createVoiceClientSecret(actorKey);
      checks.push({ name: "Realtime voice session", status: s.clientSecret ? "passed" : "failed", latencyMs: Date.now() - t0, detail: `Ephemeral client secret issued for ${s.model} (value hidden). Audio itself must be verified in a browser with a microphone.` });
    } catch (error) {
      const d = error instanceof VoiceSessionError ? error.diagnostics : undefined;
      checks.push({ name: "Realtime voice session", status: "failed", latencyMs: Date.now() - t0, detail: d ? `Could not create a voice session: ${diagText(d)}` : "Could not create a voice session.", diagnostics: d });
    }
  }
  return { mode: config.mode, reason: config.reason, models, systemCaTrusted, checks };
}
