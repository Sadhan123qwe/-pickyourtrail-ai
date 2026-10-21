import { notFound, parseBody, requirePermission, route } from "@/lib/http";
import { updateKnowledgeDoc, KnowledgeDocSchema as DocSchema } from "@/lib/repos/knowledge";
import { recordAudit } from "@/lib/repos/audit";

/** Editing bumps the version, which invalidates cached answers that cited the old text. */
export const PATCH = route<{ id: string }>({}, async ({ req, actor, params }) => {
  const user = requirePermission(actor, "knowledge:manage");
  const body = await parseBody(req, DocSchema.partial());
  const doc = updateKnowledgeDoc(params.id, body);
  if (!doc) throw notFound("Document not found");
  recordAudit({ userId: user.id, label: user.name }, "knowledge_document", doc.id, "updated", undefined, { title: doc.title, version: doc.version });
  return { document: doc };
});
