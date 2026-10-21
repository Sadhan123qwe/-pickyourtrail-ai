import { requirePermission, route } from "@/lib/http";
import { ROLES, type Role } from "@/lib/auth/permissions";
import { listEmployees } from "@/lib/repos/users";

/** Employee directory for assignment dropdowns. */
export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "users:list");
  const role = req.nextUrl.searchParams.get("role");
  const valid = role && (ROLES as readonly string[]).includes(role) && role !== "customer" ? (role as Role) : undefined;
  return { items: listEmployees(valid) };
});
