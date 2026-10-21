import { z } from "zod";
import { parseQuery, requirePermission, route } from "@/lib/http";
import { usageSummary } from "@/lib/ai/usage";

const QuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** AI usage (requests, tokens, estimated cost, outcomes) — no prompts or personal data. */
export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "settings:manage");
  const { days } = parseQuery(req, QuerySchema);
  return usageSummary(new Date(Date.now() - days * 86_400_000).toISOString());
});
