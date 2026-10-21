import { z } from "zod";
import { notFound, parseBody, requirePermission, route } from "@/lib/http";
import { addFollowUp, getLead, listFollowUps } from "@/lib/repos/leads";

export const GET = route<{ id: string }>({}, ({ actor, params }) => {
  requirePermission(actor, "leads:read");
  if (!getLead(params.id)) throw notFound("Lead not found");
  return { items: listFollowUps(params.id) };
});

const FollowUpSchema = z.object({
  dueAt: z.iso.datetime(),
  channel: z.enum(["call", "email", "whatsapp", "meeting"]),
  note: z.string().trim().max(500).optional().nullable(),
});

export const POST = route<{ id: string }>({}, async ({ req, actor, params }) => {
  const user = requirePermission(actor, "leads:write");
  if (!getLead(params.id)) throw notFound("Lead not found");
  const body = await parseBody(req, FollowUpSchema);
  return Response.json({ followUp: addFollowUp({ userId: user.id, label: user.name }, params.id, body) }, { status: 201 });
});
