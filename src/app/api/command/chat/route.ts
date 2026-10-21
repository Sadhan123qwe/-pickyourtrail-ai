import { z } from "zod";
import { parseBody, requirePermission, route } from "@/lib/http";
import { commandChat, commandHistory } from "@/lib/services/command";

const ChatSchema = z.object({
  message: z.string().trim().min(2).max(1500),
  conversationId: z.string().max(64).optional().nullable(),
  context: z
    .object({
      leadId: z.string().max(64).optional().nullable(),
      ticketId: z.string().max(64).optional().nullable(),
      customerKey: z.string().max(80).optional().nullable(),
    })
    .optional(),
});

/** AI Command Center: intent → validated, authorized tool calls → answer; writes are proposed for approval. */
export const POST = route({ rateLimit: "ai" }, async ({ req, actor }) => {
  requirePermission(actor, "copilot:use");
  const body = await parseBody(req, ChatSchema);
  return commandChat(actor, { message: body.message, conversationId: body.conversationId, context: body.context ?? {} });
});

/** The employee's latest command conversation (persisted). */
export const GET = route({}, ({ actor }) => {
  requirePermission(actor, "copilot:use");
  return commandHistory(actor);
});
