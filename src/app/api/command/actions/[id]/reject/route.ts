import { requirePermission, route } from "@/lib/http";
import { rejectAction } from "@/lib/ai/tools/registry";

export const POST = route<{ id: string }>({}, ({ actor, params }) => {
  requirePermission(actor, "copilot:use");
  return { action: rejectAction({ actor, source: "command_center", conversationId: null }, params.id) };
});
