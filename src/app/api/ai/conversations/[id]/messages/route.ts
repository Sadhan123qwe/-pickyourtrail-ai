import { paginate, route } from "@/lib/http";
import { listMessages } from "@/lib/repos/conversations";
import { loadConversationForActor } from "@/lib/services/conversations";

export const GET = route<{ id: string }>({}, ({ req, actor, params }) => {
  const conv = loadConversationForActor(actor, params.id);
  const { page, pageSize, offset } = paginate(req.nextUrl.searchParams, 100);
  return { conversationId: conv.id, page, pageSize, items: listMessages(conv.id, pageSize, offset) };
});
