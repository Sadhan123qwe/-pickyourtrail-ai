import { z } from "zod";
import { parseBody, requirePermission, route } from "@/lib/http";
import { copilotChat } from "@/lib/services/copilot";

const CopilotSchema = z.object({
  message: z.string().trim().min(2).max(1500),
  leadId: z.string().max(64).optional().nullable(),
  ticketId: z.string().max(64).optional().nullable(),
});

export const POST = route({ rateLimit: "ai" }, async ({ req, actor }) => {
  requirePermission(actor, "copilot:use");
  const body = await parseBody(req, CopilotSchema);
  return copilotChat(actor, body);
});
