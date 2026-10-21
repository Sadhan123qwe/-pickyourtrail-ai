import { conflict, parseBody, requirePermission, route } from "@/lib/http";
import { can } from "@/lib/auth/permissions";
import { createKnowledgeDoc, listKnowledge, KnowledgeDocSchema as DocSchema } from "@/lib/repos/knowledge";
import { recordAudit } from "@/lib/repos/audit";

export const GET = route({}, ({ actor }) => {
  requirePermission(actor, "copilot:use");
  return { items: listKnowledge(can(actor.role, "knowledge:read_internal")).map((d) => ({ ...d, isDemo: !!d.is_demo })), canManage: can(actor.role, "knowledge:manage") };
});



/** Admins add approved company knowledge. AI answers can only cite approved documents. */
export const POST = route({}, async ({ req, actor }) => {
  const user = requirePermission(actor, "knowledge:manage");
  const body = await parseBody(req, DocSchema);
  try {
    const doc = createKnowledgeDoc(body);
    recordAudit({ userId: user.id, label: user.name }, "knowledge_document", doc.id, "created", undefined, { title: doc.title });
    return Response.json({ document: doc }, { status: 201 });
  } catch {
    throw conflict("A document with this title already exists");
  }
});
