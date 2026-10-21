import "server-only";

/**
 * Server-only configuration. Never import this from a client component:
 * the `server-only` import makes such an import a build error.
 */

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type AiMode = "live" | "mock";

export interface AiConfig {
  mode: AiMode;
  /** Human-readable reason, safe to show in the UI (never contains secrets). */
  reason: string;
  apiKey?: string;
  baseURL?: string;
  models: {
    /** Low-cost model for extraction, FAQ answers and simple edits. */
    routine: string;
    /** Used only where quality justifies it (itinerary planning). */
    advanced: string;
    realtime: string;
    transcription: string;
  };
  limits: {
    maxOutputTokens: number;
    timeoutMs: number;
    maxRetries: number;
  };
}

export function getAiConfig(): AiConfig {
  const apiKey = readEnv("OPENAI_API_KEY");
  const forcedMock = readEnv("AI_MODE") === "mock";
  // Defaults follow the current OpenAI models page (checked 2026-10): the cost-efficient text model
  // and the non-deprecated mini realtime model. Accounts differ — verify with `npm run ai:check`.
  const routine = readEnv("OPENAI_MODEL") ?? "gpt-6-luna";
  const config: Omit<AiConfig, "mode" | "reason"> = {
    apiKey,
    baseURL: readEnv("OPENAI_BASE_URL"),
    models: {
      routine,
      advanced: readEnv("OPENAI_MODEL_ADVANCED") ?? routine,
      realtime: readEnv("OPENAI_REALTIME_MODEL") ?? "gpt-realtime-2.1-mini",
      // Supports server VAD over WebRTC; scheduled for shutdown on 2027-02-26 (see README).
      transcription: readEnv("OPENAI_TRANSCRIPTION_MODEL") ?? "gpt-4o-mini-transcribe",
    },
    limits: {
      maxOutputTokens: readNumber("AI_MAX_OUTPUT_TOKENS", 900),
      timeoutMs: readNumber("AI_TIMEOUT_MS", 20_000),
      maxRetries: Math.min(readNumber("AI_MAX_RETRIES", 2), 3),
    },
  };
  if (forcedMock) {
    return { ...config, mode: "mock", reason: "AI_MODE=mock is set, so deterministic demo responses are used." };
  }
  if (!apiKey) {
    return {
      ...config,
      mode: "mock",
      reason: "OPENAI_API_KEY is not configured, so deterministic demo responses are used.",
    };
  }
  if (!/^sk-[A-Za-z0-9_\-]{10,}$/.test(apiKey)) {
    return {
      ...config,
      mode: "mock",
      reason: "OPENAI_API_KEY does not look like a valid OpenAI key, so deterministic demo responses are used.",
    };
  }
  return { ...config, mode: "live", reason: `Live AI via OpenAI (${routine}).` };
}

export function getDatabasePath(): string {
  return readEnv("DATABASE_PATH") ?? "data/pickyourtrail.db";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getAppUrl(): string {
  return readEnv("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
}
