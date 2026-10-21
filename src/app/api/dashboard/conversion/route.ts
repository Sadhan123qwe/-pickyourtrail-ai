import { z } from "zod";
import { parseQuery, requirePermission, route } from "@/lib/http";
import { defaultRange, funnel } from "@/lib/repos/metrics";

const QuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "dashboard:read");
  const { days } = parseQuery(req, QuerySchema);
  const range = defaultRange(days);
  return { range, funnel: funnel(range) };
});
