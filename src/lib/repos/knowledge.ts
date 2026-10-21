import "server-only";
import { z } from "zod";
import { all, get, newId, nowIso, run } from "@/lib/db";

/**
 * Knowledge retrieval adapter: lightweight keyword (TF-IDF style) search over
 * approved documents in SQLite. Retrieval runs before any AI call, and its
 * results are the only evidence the AI may use. A vector store could replace
 * this behind the same function signature.
 */

export interface KnowledgeDoc {
  id: string;
  slug: string;
  title: string;
  category: string;
  audience: "public" | "internal";
  body: string;
  tags: string;
  is_demo: number;
  version: number;
  updated_at: string;
}

export interface KnowledgeHit {
  id: string;
  slug: string;
  title: string;
  category: string;
  audience: "public" | "internal";
  score: number;
  snippet: string;
  isDemo: boolean;
  version: number;
}

const STOP = new Set(
  "a an and are as at be but by can do does for from how i if in is it my me of on or our so that the this to was we what when where which who why will with you your have has had get any about would could should there their they them than then also just".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => t.replace(/(ies)$/, "y").replace(/(s)$/, ""));
}

export function listKnowledge(includeInternal: boolean): KnowledgeDoc[] {
  return all<KnowledgeDoc>(
    `SELECT * FROM knowledge_documents ${includeInternal ? "" : "WHERE audience = 'public'"} ORDER BY audience, category, title`,
  );
}

export function searchKnowledge(query: string, opts: { includeInternal: boolean; limit?: number; minScore?: number }): KnowledgeHit[] {
  const docs = listKnowledge(opts.includeInternal);
  const q = Array.from(new Set(tokenize(query)));
  if (!q.length || !docs.length) return [];
  const docTokens = docs.map((d) => ({ d, title: tokenize(`${d.title} ${d.tags}`), body: tokenize(d.body) }));
  const df = new Map<string, number>();
  for (const { title, body } of docTokens) for (const t of new Set([...title, ...body])) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const hits = docTokens.map(({ d, title, body }) => {
    let score = 0;
    for (const term of q) {
      const idf = Math.log(1 + n / (df.get(term) ?? 0.5));
      const tf = body.filter((t) => t === term).length;
      const inTitle = title.includes(term) ? 1 : 0;
      score += idf * (Math.min(tf, 5) * 0.6 + inTitle * 2.5);
    }
    return { d, score: score / Math.sqrt(q.length) };
  });
  return hits
    .filter((h) => h.score >= (opts.minScore ?? 1.2))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 3)
    .map(({ d, score }) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
      category: d.category,
      audience: d.audience,
      score: Math.round(score * 100) / 100,
      snippet: bestParagraph(d.body, q),
      isDemo: !!d.is_demo,
      version: d.version,
    }));
}

function bestParagraph(body: string, q: string[]): string {
  // The demo disclaimer paragraph is shown as a label elsewhere; never use it as the answer snippet.
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^Demonstration content:/i.test(p));
  let best = paragraphs[0] ?? body;
  let bestScore = -1;
  for (const p of paragraphs) {
    const toks = tokenize(p);
    const s = q.reduce((acc, t) => acc + (toks.includes(t) ? 1 : 0), 0);
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best.slice(0, 700);
}

export const KnowledgeDocSchema = z.object({
  title: z.string().trim().min(3).max(160),
  category: z.string().trim().min(2).max(60),
  audience: z.enum(["public", "internal"]),
  body: z.string().trim().min(20).max(20_000),
  tags: z.string().trim().max(300).default(""),
});

export function getKnowledgeDoc(id: string): KnowledgeDoc | undefined {
  return get<KnowledgeDoc>("SELECT * FROM knowledge_documents WHERE id = ?", [id]);
}

function slugify(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export function createKnowledgeDoc(input: z.infer<typeof KnowledgeDocSchema>): KnowledgeDoc {
  const id = newId("kb");
  run(
    "INSERT INTO knowledge_documents (id, slug, title, category, audience, body, tags, is_demo, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)",
    [id, slugify(input.title), input.title, input.category, input.audience, input.body, input.tags ?? "", nowIso()],
  );
  return getKnowledgeDoc(id)!;
}

/** Edits bump the version; cached answers are keyed by document version, so they're invalidated automatically. */
export function updateKnowledgeDoc(id: string, patch: Partial<z.infer<typeof KnowledgeDocSchema>>): KnowledgeDoc | undefined {
  const doc = getKnowledgeDoc(id);
  if (!doc) return undefined;
  const next = { ...doc, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  run("UPDATE knowledge_documents SET title = ?, category = ?, audience = ?, body = ?, tags = ?, version = version + 1, updated_at = ? WHERE id = ?", [
    next.title, next.category, next.audience, next.body, next.tags, nowIso(), id,
  ]);
  return getKnowledgeDoc(id);
}
