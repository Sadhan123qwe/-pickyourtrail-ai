import { z } from "zod";
import { paginate, parseBody, requirePermission, route } from "@/lib/http";
import { TICKET_CATEGORIES } from "@/lib/workflows/rules";
import { listTickets, listTicketsForOwner } from "@/lib/repos/tickets";
import { createSupportTicket } from "@/lib/services/support";

const CreateSchema = z.object({
  subject: z.string().trim().max(160).optional().nullable(),
  message: z.string().trim().min(5, "Please describe the issue").max(4000),
  tripId: z.string().max(64).optional().nullable(),
  conversationId: z.string().max(64).optional().nullable(),
  contactEmail: z.email().max(120).optional().nullable(),
  idempotencyKey: z.string().min(8).max(80).optional().nullable(),
});

/** Customers create tickets; triage (category, priority, escalation) is deterministic. */
export const POST = route({}, async ({ req, actor }) => {
  const body = await parseBody(req, CreateSchema);
  const result = createSupportTicket({ actor, ...body });
  return Response.json(result, { status: result.duplicate ? 200 : 201 });
});

/**
 * GET /api/support/tickets           → caller's own tickets
 * GET /api/support/tickets?scope=all → operations queue (tickets:read)
 */
export const GET = route({}, ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  if (sp.get("scope") === "all") {
    requirePermission(actor, "tickets:read");
    const { page, pageSize, offset } = paginate(sp);
    const category = sp.get("category");
    const { items, total } = listTickets({
      q: sp.get("q")?.slice(0, 80) ?? undefined,
      status: sp.get("status") ?? undefined,
      priority: sp.get("priority") ?? undefined,
      category: category && (TICKET_CATEGORIES as readonly string[]).includes(category) ? category : undefined,
      assignedTo: sp.get("assignedTo") === "me" ? actor.userId ?? undefined : sp.get("assignedTo") ?? undefined,
      escalated: sp.get("escalated") === "true",
      sort: (["updated_desc", "priority_desc", "created_asc"] as const).find((s) => s === sp.get("sort")),
      limit: pageSize,
      offset,
    });
    return { items, total, page, pageSize };
  }
  const items = listTicketsForOwner(actor);
  return { items, total: items.length, page: 1, pageSize: items.length };
});
