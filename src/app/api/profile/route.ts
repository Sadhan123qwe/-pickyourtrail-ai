import { route } from "@/lib/http";
import { PERMISSIONS, can, isEmployee } from "@/lib/auth/permissions";

/** Current identity. Anonymous visitors get `user: null` (and an anonymous session cookie). */
export const GET = route({}, ({ actor }) => ({
  user: actor.user,
  isEmployee: isEmployee(actor.role),
  permissions: PERMISSIONS.filter((p) => can(actor.role, p)),
}));
