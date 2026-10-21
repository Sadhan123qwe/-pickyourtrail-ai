import "server-only";
import OpenAI from "openai";
import { trustSystemCertificates } from "@/lib/net/system-ca";
import type { z } from "zod";
import { getAiConfig } from "@/lib/config";
import { toStrictJsonSchema } from "./json-schema";

export interface StructuredRequest<T> {
  category: string;
  model: string;
  /** Stable instructions: kept identical across calls to improve prompt-cache hits. */
  system: string;
  /** Compact, request-specific input (never the full conversation history). */
  input: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
}

export interface StructuredResponse<T> {
  value: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface AiProvider {
  name: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

export class MalformedOutputError extends Error {
  code = "malformed_output";
}

/** Live adapter: OpenAI Responses API with strict JSON-schema structured output. */
export class OpenAiProvider implements AiProvider {
  name = "openai";
  private client: OpenAI;

  constructor(opts: { apiKey: string; baseURL?: string; timeoutMs: number; maxRetries: number }) {
    // The SDK retries connection errors, 408/409/429 and 5xx with exponential backoff (bounded by maxRetries).
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, timeout: opts.timeoutMs, maxRetries: opts.maxRetries });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const schema = toStrictJsonSchema(req.schema);
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    // One extra attempt only for malformed output; transport errors are retried by the SDK.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.client.responses.create({
        model: req.model,
        instructions: req.system,
        input: req.input,
        max_output_tokens: req.maxOutputTokens,
        store: false,
        prompt_cache_key: `pyt-${req.category}`,
        text: { format: { type: "json_schema", name: req.schemaName, schema, strict: true } },
      });
      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
      cachedTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
      try {
        const parsed = req.schema.safeParse(JSON.parse(response.output_text));
        if (parsed.success) {
          return { value: parsed.data, model: response.model ?? req.model, inputTokens, outputTokens, cachedTokens };
        }
      } catch {
        // fall through to retry
      }
    }
    const err = new MalformedOutputError("The AI response did not match the expected format");
    Object.assign(err, { usage: { inputTokens, outputTokens, cachedTokens } });
    throw err;
  }
}

let override: AiProvider | null | undefined;

/** Test hook: inject a fake provider (or null to restore the default). */
export function setAiProviderForTests(provider: AiProvider | null) {
  override = provider ?? undefined;
}

export function getAiProvider(): AiProvider | null {
  if (override) return override;
  const config = getAiConfig();
  if (config.mode !== "live" || !config.apiKey) return null;
  trustSystemCertificates();
  return new OpenAiProvider({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeoutMs: config.limits.timeoutMs,
    maxRetries: config.limits.maxRetries,
  });
}

const TLS_CAUSES = new Set([
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
const DNS_CAUSES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

/** Finds the first `code` in an error's cause chain (e.g. fetch failed → UNABLE_TO_GET_ISSUER_CERT_LOCALLY). */
function causeCode(error: unknown): string | null {
  let e: unknown = error;
  for (let i = 0; i < 5 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z_0-9]+$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Classifies a provider error into a stable code. Transport failures are kept
 * separate from HTTP errors (401 auth, 403 permission, 404 model, 429 quota/rate).
 */
export function classifyError(error: unknown): { code: string; rateLimited: boolean } {
  if (error instanceof OpenAI.RateLimitError) {
    const body = JSON.stringify((error as { error?: unknown }).error ?? "");
    return { code: body.includes("insufficient_quota") ? "quota_exhausted" : "rate_limited", rateLimited: true };
  }
  if (error instanceof OpenAI.AuthenticationError) return { code: "invalid_api_key", rateLimited: false };
  if (error instanceof OpenAI.PermissionDeniedError) return { code: "permission_denied", rateLimited: false };
  if (error instanceof OpenAI.NotFoundError) return { code: "model_unavailable", rateLimited: false };
  if (error instanceof OpenAI.APIConnectionTimeoutError) return { code: "timeout", rateLimited: false };
  if (error instanceof OpenAI.APIConnectionError) {
    const cause = causeCode(error);
    if (cause && TLS_CAUSES.has(cause)) return { code: "tls_untrusted_certificate", rateLimited: false };
    if (cause && DNS_CAUSES.has(cause)) return { code: "dns_error", rateLimited: false };
    return { code: "connection_error", rateLimited: false };
  }
  if (error instanceof OpenAI.APIError) return { code: `http_${error.status ?? "unknown"}`, rateLimited: false };
  if (error instanceof MalformedOutputError) return { code: "malformed_output", rateLimited: false };
  return { code: "unknown_error", rateLimited: false };
}

export interface ErrorDiagnostics {
  code: string;
  errorClass: string;
  status: number | null;
  requestId: string | null;
  causeCode: string | null;
  hint: string;
}

const HINTS: Record<string, string> = {
  tls_untrusted_certificate:
    "The HTTPS certificate presented for api.openai.com isn't trusted by Node — usually a TLS-inspecting proxy (e.g. Zscaler). The app trusts the OS certificate store automatically on Node 22.19+/24.5+; otherwise start Node with --use-system-ca or set NODE_EXTRA_CA_CERTS to the proxy's root certificate.",
  dns_error: "api.openai.com could not be resolved. Check DNS, VPN and network access.",
  connection_error: "Could not reach the API (connection refused/reset or blocked by a firewall or proxy). Check network access to api.openai.com:443 and OPENAI_BASE_URL.",
  timeout: "The request timed out. Check network latency or raise AI_TIMEOUT_MS.",
  invalid_api_key: "The API key was rejected (HTTP 401). Create a new key and set OPENAI_API_KEY in .env.local.",
  permission_denied: "The project or organisation isn't allowed to use this resource (HTTP 403). Check the key's project, model access and region restrictions.",
  model_unavailable: "The model doesn't exist or isn't available to this API project (HTTP 404). Choose an available model in .env.local.",
  quota_exhausted: "The API account has no remaining quota or credit (HTTP 429 insufficient_quota). Check billing.",
  rate_limited: "Rate limit reached (HTTP 429). Retry later.",
  malformed_output: "The model's reply didn't match the expected schema.",
};

/** Safe, secret-free diagnostics for logs and admin checks (no headers, keys or request config). */
export function describeError(error: unknown): ErrorDiagnostics {
  const { code } = classifyError(error);
  const api = error instanceof OpenAI.APIError ? error : null;
  return {
    code,
    errorClass: error instanceof Error ? error.constructor.name : typeof error,
    status: typeof api?.status === "number" ? api.status : null,
    requestId: api?.requestID ?? null,
    causeCode: causeCode(error),
    hint: HINTS[code] ?? (code.startsWith("http_") ? `The API returned ${code.replace("http_", "HTTP ")}.` : "Unexpected error."),
  };
}
