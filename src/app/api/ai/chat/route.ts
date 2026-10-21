import { z } from "zod";
import { parseBody, route } from "@/lib/http";
import { handlePlannerMessage, startPlanning } from "@/lib/services/planner";
import { supportChat } from "@/lib/services/support";

const ChatSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("planner"),
    tripId: z.string().min(1).max(64).optional(),
    message: z.string().trim().min(1, "Please type a message").max(1500),
    clientMessageId: z.string().min(8).max(64).optional(),
    channel: z.enum(["text", "voice"]).optional(),
  }),
  z.object({
    mode: z.literal("support"),
    conversationId: z.string().min(1).max(64).optional(),
    tripId: z.string().min(1).max(64).optional(),
    message: z.string().trim().min(1, "Please type a message").max(1500),
    clientMessageId: z.string().min(8).max(64).optional(),
  }),
]);

/**
 * Conversational AI endpoint for the trip planner and customer support.
 * Planner: structured preference extraction + deterministic next question.
 * Support: retrieval-grounded answers with deterministic triage/escalation.
 */
export const POST = route({ rateLimit: "ai" }, async ({ req, actor }) => {
  const body = await parseBody(req, ChatSchema);
  if (body.mode === "planner") {
    const tripId = body.tripId ?? startPlanning(actor).trip.id;
    return handlePlannerMessage({ actor, tripId, message: body.message, clientMessageId: body.clientMessageId, channel: body.channel });
  }
  return supportChat({ actor, message: body.message, conversationId: body.conversationId, tripId: body.tripId, clientMessageId: body.clientMessageId });
});
