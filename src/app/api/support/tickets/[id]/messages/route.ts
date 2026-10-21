import { z } from "zod";
import { parseBody, route } from "@/lib/http";
import { can } from "@/lib/auth/permissions";
import { postTicketMessage } from "@/lib/services/support";

const MessageSchema = z.object({
  body: z.string().trim().min(1, "Message can't be empty").max(4000),
  /** Internal notes are visible to employees only. */
  internal: z.boolean().optional(),
});

export const POST = route<{ id: string }>({}, async ({ req, actor, params }) => {
  const body = await parseBody(req, MessageSchema);
  const asAgent = can(actor.role, "tickets:write");
  const messages = postTicketMessage(actor, params.id, body.body, { asAgent, internal: body.internal });
  return Response.json({ messages }, { status: 201 });
});
