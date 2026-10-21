import { route } from "@/lib/http";
import { aiStatus } from "@/lib/ai/run";
import { getAiConfig } from "@/lib/config";

/** Safe AI configuration summary for the UI. Never includes secrets. */
export const GET = route({}, () => {
  const status = aiStatus();
  const config = getAiConfig();
  return {
    ...status,
    voice: {
      realtimeAvailable: config.mode === "live",
      reason: config.mode === "live" ? "OpenAI Realtime voice can be started." : "Voice demo unavailable: live AI is not configured.",
    },
  };
});
