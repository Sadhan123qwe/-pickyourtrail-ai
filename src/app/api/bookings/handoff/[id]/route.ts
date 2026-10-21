import { z } from "zod";
import { ApiError, badRequest, notFound, parseBody, requirePermission, route } from "@/lib/http";
import { HandoffError, OPS_STATUSES, allowedOpsTransitions, getHandoff, updateHandoff } from "@/lib/repos/handoffs";
import { listAudit } from "@/lib/repos/audit";
import { getUser } from "@/lib/repos/users";

export const GET = route<{ id: string }>({}, ({ actor, params }) => {
  requirePermission(actor, "trips:read_all");
  const handoff = getHandoff(params.id);
  if (!handoff) throw notFound("Booking handoff not found");
  return { handoff, allowedTransitions: allowedOpsTransitions(handoff.ops_status), audit: listAudit({ entityType: "booking_handoff", entityId: handoff.id }) };
});

const PatchSchema = z.object({
  opsStatus: z.enum(OPS_STATUSES).optional(),
  assignedTo: z.string().max(64).nullable().optional(),
  quotedTotal: z.number().int().min(0).max(100_000_000).nullable().optional(),
  note: z.string().trim().max(1000).optional(),
});

/** Ops updates. Provider confirmation cannot be set here — only by a provider adapter. */
export const PATCH = route<{ id: string }>({}, async ({ req, actor, params }) => {
  const user = requirePermission(actor, "trips:write_ops");
  const body = await parseBody(req, PatchSchema);
  if (body.assignedTo) {
    const assignee = getUser(body.assignedTo);
    if (!assignee || assignee.role === "customer") throw badRequest("Assignee must be an employee");
  }
  try {
    return { handoff: updateHandoff({ userId: user.id, label: user.name }, params.id, body) };
  } catch (e) {
    if (e instanceof HandoffError) throw e.code === "not_found" ? notFound(e.message) : new ApiError(409, "invalid_transition", e.message);
    throw e;
  }
});
