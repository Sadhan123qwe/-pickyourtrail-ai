import { requirePermission, route } from "@/lib/http";
import { notifications } from "@/lib/services/workspace";

/** Notifications and AI activity for the employee top bar (derived from stored records). */
export const GET = route({}, ({ actor }) => {
  requirePermission(actor, "dashboard:read");
  return notifications(actor);
});
