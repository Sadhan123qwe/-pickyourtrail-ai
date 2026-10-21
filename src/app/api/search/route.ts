import { z } from "zod";
import { parseQuery, requirePermission, route } from "@/lib/http";
import { globalSearch } from "@/lib/services/workspace";

const QuerySchema = z.object({ q: z.string().trim().min(2).max(80) });

/** Global search for the employee top bar, limited to records the employee may see. */
export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "dashboard:read");
  const { q } = parseQuery(req, QuerySchema);
  return globalSearch(actor, q);
});
