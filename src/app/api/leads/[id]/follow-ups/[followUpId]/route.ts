import { z } from "zod";
import { notFound, parseBody, requirePermission, route } from "@/lib/http";
import { updateFollowUp } from "@/lib/repos/leads";

const PatchSchema = z.object({ status: z.enum(["done", "cancelled"]) });

export const PATCH = route<{ id: string; followUpId: string }>({}, async ({ req, actor, params }) => {
  const user = requirePermission(actor, "leads:write");
  const body = await parseBody(req, PatchSchema);
  const followUp = updateFollowUp({ userId: user.id, label: user.name }, params.id, params.followUpId, body.status);
  if (!followUp) throw notFound("Follow-up not found");
  return { followUp };
});
