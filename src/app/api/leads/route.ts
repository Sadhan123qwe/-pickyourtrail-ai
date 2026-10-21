import { z } from "zod";
import { conflict, paginate, parseBody, requirePermission, route } from "@/lib/http";
import { LEAD_STAGES } from "@/lib/workflows/rules";
import { LeadError, createManualLead, listLeads } from "@/lib/repos/leads";

export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "leads:read");
  const sp = req.nextUrl.searchParams;
  const { page, pageSize, offset } = paginate(sp);
  const stage = sp.get("stage");
  const { items, total } = listLeads({
    q: sp.get("q")?.slice(0, 80) ?? undefined,
    stage: stage && (LEAD_STAGES as readonly string[]).includes(stage) ? stage : undefined,
    assignedTo: sp.get("assignedTo") === "me" ? actor.userId ?? undefined : sp.get("assignedTo") ?? undefined,
    source: sp.get("source") ?? undefined,
    sort: (["created_desc", "score_desc", "follow_up_asc", "value_desc"] as const).find((s) => s === sp.get("sort")),
    limit: pageSize,
    offset,
  });
  return { items, total, page, pageSize };
});

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(120).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  destination: z.string().trim().max(80).optional().nullable(),
  travelMonth: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  travellers: z.number().int().min(1).max(40).optional().nullable(),
  budget: z.number().int().min(0).max(100_000_000).optional().nullable(),
  assignedTo: z.string().max(64).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

export const POST = route({}, async ({ req, actor }) => {
  const user = requirePermission(actor, "leads:write");
  const body = await parseBody(req, CreateSchema);
  try {
    return Response.json({ lead: createManualLead({ userId: user.id, label: user.name }, body) }, { status: 201 });
  } catch (e) {
    if (e instanceof LeadError && e.code === "duplicate") throw conflict(e.message);
    throw e;
  }
});
