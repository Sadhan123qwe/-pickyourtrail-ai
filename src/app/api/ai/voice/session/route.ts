import { z } from "zod";
import { NextResponse } from "next/server";
import { ApiError, parseBody, route } from "@/lib/http";
import { getAiConfig } from "@/lib/config";
import { checkLiveCallAllowed } from "@/lib/ai/usage";
import { createVoiceClientSecret, VoiceSessionError } from "@/lib/ai/voice-session";
import { loadTripForActor } from "@/lib/services/planner";

const SessionSchema = z.object({ tripId: z.string().min(1).max(64) });

/**
 * Issues a short-lived OpenAI Realtime client secret for WebRTC voice, only for
 * the caller's own trip. The permanent API key never leaves the server. Voice
 * transcripts go through /api/ai/chat so voice and text share one trip profile,
 * and the realtime model only speaks the planner's replies.
 */
export const POST = route({ rateLimit: "ai" }, async ({ req, actor }) => {
  const { tripId } = await parseBody(req, SessionSchema);
  loadTripForActor(actor, tripId);
  const config = getAiConfig();
  if (config.mode !== "live" || !config.apiKey) {
    return NextResponse.json(
      { error: { code: "voice_unavailable", message: "Voice demo unavailable: live AI is not configured on this server. Please use text chat." } },
      { status: 503 },
    );
  }
  const blocked = checkLiveCallAllowed(actor.key);
  if (blocked) {
    throw new ApiError(429, blocked, "Voice is temporarily unavailable because the AI usage limit has been reached. Please use text chat.");
  }
  try {
    return await createVoiceClientSecret(actor.key);
  } catch (error) {
    const code = error instanceof VoiceSessionError ? error.code : "voice_unavailable";
    throw new ApiError(502, "voice_unavailable", `Voice session couldn't be started right now (${code}). Please use text chat.`);
  }
});
