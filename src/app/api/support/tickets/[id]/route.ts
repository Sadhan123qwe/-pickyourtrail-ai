import { z } from "zod";
import { ApiError, badRequest, forbidden, notFound, parseBody, route } from "@/lib/http";
import { can, ownsRecord } from "@/lib/auth/permissions";
import { TICKET_STATUSES, allowedTicketTransitions } from "@/lib/workflows/rules";
import { TicketError, updateTicket } from "@/lib/repos/tickets";
import { listAudit } from "@/lib/repos/audit";
import { getUser } from "@/lib/repos/users";
import { loadTicketForActor, ticketDetail } from "@/lib/services/support";

export const GET = route<{ id: string }>({}, ({ actor, params }) => {
  const employee = can(actor.role, "tickets:read");
  const detail = ticketDetail(actor, params.id, can(actor.role, "tickets:write"));
  return {
    ...detail,
    allowedTransitions: employee ? allowedTicketTransitions(detail.ticket.status) : undefined,
    audit: employee ? listAudit({ entityType: "ticket", entityId: params.id, limit: 30 }) : undefined,
  };
});

const EmployeePatch = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  assignedTo: z.string().max(64).nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  escalate: z.boolean().optional(),
  escalationReason: z.string().trim().max(300).optional(),
});

const CustomerPatch = z.object({
  status: z.literal("closed").optional(),
  csatScore: z.number().int().min(1).max(5).optional(),
});

export const PATCH = route<{ id: string }>({}, async ({ req, actor, params }) => {
  const ticket = loadTicketForActor(actor, params.id);
  const label = actor.user?.name ?? "Customer";
  try {
    if (can(actor.role, "tickets:write")) {
      const body = await parseBody(req, EmployeePatch);
      if (body.assignedTo) {
        const assignee = getUser(body.assignedTo);
        if (!assignee || assignee.role === "customer") throw badRequest("Assignee must be an employee");
      }
      return { ticket: updateTicket({ userId: actor.userId, label }, ticket.id, body) };
    }
    if (!ownsRecord(actor, ticket)) throw forbidden();
    const body = await parseBody(req, CustomerPatch);
    if (body.csatScore !== undefined && !["resolved", "closed"].includes(ticket.status) && body.status !== "closed") {
      throw badRequest("You can rate support once the ticket is resolved");
    }
    return { ticket: updateTicket({ userId: actor.userId, label }, ticket.id, body) };
  } catch (e) {
    if (e instanceof TicketError) throw e.code === "not_found" ? notFound(e.message) : new ApiError(409, "invalid_transition", e.message);
    throw e;
  }
});
