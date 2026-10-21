import "server-only";
import OpenAI from "openai";
import { getAiConfig } from "@/lib/config";
import { classifyError, describeError, type ErrorDiagnostics } from "@/lib/ai/provider";
import { recordUsage } from "@/lib/ai/usage";
import { trustSystemCertificates } from "@/lib/net/system-ca";

export const VOICE_INSTRUCTIONS = `You are the speaking voice of Pickyourtrail's AI trip planner.
You never decide what to say yourself. When you receive a response request, read the provided text aloud naturally, in a warm, friendly and clear voice, without adding, removing or changing any facts.`;

export class VoiceSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly diagnostics?: ErrorDiagnostics,
  ) {
    super(message);
  }
}

/**
 * Creates a short-lived OpenAI Realtime client secret (WebRTC). The permanent
 * key stays on the server; only the ephemeral secret goes to the browser.
 * Turn detection is on and automatic responses are off: transcripts are routed
 * through the planner API and the model only voices the planner's replies.
 */
export async function createVoiceClientSecret(actorKey: string): Promise<{ clientSecret: string; expiresAt: number | null; model: string }> {
  const config = getAiConfig();
  if (config.mode !== "live" || !config.apiKey) throw new VoiceSessionError("voice_unavailable", "Live AI is not configured.");
  trustSystemCertificates();
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: config.limits.timeoutMs, maxRetries: 1 });
  const started = Date.now();
  try {
    const secret = await client.realtime.clientSecrets.create({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: config.models.realtime,
        instructions: VOICE_INSTRUCTIONS,
        output_modalities: ["audio"],
        max_output_tokens: 400,
        audio: {
          input: {
            transcription: { model: config.models.transcription },
            turn_detection: { type: "server_vad", create_response: false },
          },
          output: { voice: "marin" },
        },
      },
    });
    recordUsage({ actorKey, category: "voice_session", provider: "openai", model: config.models.realtime, latencyMs: Date.now() - started, outcome: "ok" });
    return { clientSecret: secret.value, expiresAt: secret.expires_at ?? null, model: config.models.realtime };
  } catch (error) {
    const { code } = classifyError(error);
    recordUsage({ actorKey, category: "voice_session", provider: "openai", model: config.models.realtime, latencyMs: Date.now() - started, outcome: "error", errorCode: code });
    throw new VoiceSessionError(code, "Voice session couldn't be started right now.", describeError(error));
  }
}
