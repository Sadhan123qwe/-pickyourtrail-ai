import { requirePermission, route } from "@/lib/http";
import { commandOverview } from "@/lib/services/command";

/** Command Center queues, derived from persisted records and filtered by role. No AI call. */
export const GET = route({}, ({ actor }) => {
  requirePermission(actor, "dashboard:read");
  return commandOverview(actor);
});
