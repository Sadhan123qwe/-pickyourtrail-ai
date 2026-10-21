import { z } from "zod";
import { parseQuery, requirePermission, route } from "@/lib/http";
import { listAudit } from "@/lib/repos/audit";

const QuerySchema = z.object({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "audit:read");
  const q = parseQuery(req, QuerySchema);
  return { items: listAudit(q) };
});
