import { route } from "@/lib/http";
import { listKnowledge } from "@/lib/repos/knowledge";

/** Public help articles (demonstration content, clearly labelled). */
export const GET = route({}, () => ({
  items: listKnowledge(false).map((d) => ({ id: d.id, slug: d.slug, title: d.title, category: d.category, body: d.body, isDemo: !!d.is_demo })),
}));
