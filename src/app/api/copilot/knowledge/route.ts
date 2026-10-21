import { requirePermission, route } from "@/lib/http";
import { can } from "@/lib/auth/permissions";
import { listKnowledge, searchKnowledge } from "@/lib/repos/knowledge";

/** Approved knowledge documents: listing, or keyword search with ?q=. */
export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "copilot:use");
  const includeInternal = can(actor.role, "knowledge:read_internal");
  const q = req.nextUrl.searchParams.get("q")?.slice(0, 200);
  if (q) return { query: q, hits: searchKnowledge(q, { includeInternal, limit: 5, minScore: 0.5 }) };
  return {
    items: listKnowledge(includeInternal).map((d) => ({
      id: d.id, slug: d.slug, title: d.title, category: d.category, audience: d.audience, body: d.body, isDemo: !!d.is_demo, updatedAt: d.updated_at,
    })),
  };
});
