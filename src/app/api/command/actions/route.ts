import { z } from "zod";
import { parseQuery, requirePermission, route } from "@/lib/http";
import { listAiActions } from "@/lib/repos/ai-actions";

const QuerySchema = z.object({
  status: z.enum(["pending", "completed", "proposed", "rejected", "failed", "expired"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** AI action log: tool calls, approvals and outcomes. */
export const GET = route({}, ({ req, actor }) => {
  const user = requirePermission(actor, "copilot:use");
  const q = parseQuery(req, QuerySchema);
  const mine = q.mine === "true" || (q.status === "pending" && user.role !== "admin");
  return { items: listAiActions({ status: q.status, actorUserId: mine ? user.id : undefined, limit: q.limit }) };
});
