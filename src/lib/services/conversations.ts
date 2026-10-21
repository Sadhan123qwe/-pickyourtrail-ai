import "server-only";
import { can, ownsRecord } from "@/lib/auth/permissions";
import { forbidden, notFound, type Actor } from "@/lib/http";
import { getConversation, type ConversationRow } from "@/lib/repos/conversations";

/** Owners can read their conversations; employees only the kinds their role covers. */
export function loadConversationForActor(actor: Actor, id: string): ConversationRow {
  const conv = getConversation(id);
  if (!conv) throw notFound("Conversation not found");
  const employeeAccess =
    (conv.kind === "planner" && can(actor.role, "trips:read_all")) || (conv.kind === "support" && can(actor.role, "tickets:read"));
  if (!ownsRecord(actor, conv) && !employeeAccess) throw forbidden();
  return conv;
}
