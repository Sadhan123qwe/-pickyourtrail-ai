import { requirePermission, route } from "@/lib/http";
import { confirmAction } from "@/lib/ai/tools/registry";

/** Human approval of a proposed AI action. The tool is re-authorized and re-validated before it runs. */
export const POST = route<{ id: string }>({}, async ({ actor, params }) => {
  requirePermission(actor, "copilot:use");
  const action = await confirmAction({ actor, source: "command_center", conversationId: null }, params.id);
  return { action };
});
