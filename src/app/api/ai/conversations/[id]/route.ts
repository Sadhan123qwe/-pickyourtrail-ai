import { route } from "@/lib/http";
import { loadConversationForActor } from "@/lib/services/conversations";

export const GET = route<{ id: string }>({}, ({ actor, params }) => {
  const conv = loadConversationForActor(actor, params.id);
  return {
    conversation: {
      id: conv.id,
      kind: conv.kind,
      tripId: conv.trip_id,
      summary: conv.summary,
      status: conv.status,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
    },
  };
});
