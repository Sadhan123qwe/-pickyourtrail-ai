import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { parseQuery, requirePermission, route } from "@/lib/http";
import { dashboardOverview } from "@/lib/repos/metrics";
import { operationalExceptions } from "@/lib/repos/operations";

const QuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "dashboard:read");
  const { days } = parseQuery(req, QuerySchema);
  const r = actor.role;
  // Exceptions are rule-computed and filtered to what the role may see.
  const exceptions = operationalExceptions().filter((e) =>
    e.type === "urgent_ticket" ? can(r, "tickets:read") : e.type.includes("handoff") ? can(r, "trips:read_all") : e.type === "overdue_follow_up" ? can(r, "leads:read") : true,
  );
  return { ...dashboardOverview(days), exceptions: exceptions.slice(0, 6) };
});
