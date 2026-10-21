import { forbidden, paginate, requireUser, route } from "@/lib/http";
import { can } from "@/lib/auth/permissions";
import { listCustomers } from "@/lib/repos/customers";

/** Customers derived from accounts and planning sessions (sales and support only). */
export const GET = route({}, ({ req, actor }) => {
  const user = requireUser(actor);
  if (!can(user.role, "leads:read") && !can(user.role, "tickets:read")) throw forbidden();
  const sp = req.nextUrl.searchParams;
  const { page, pageSize, offset } = paginate(sp);
  const { items, total } = listCustomers({ q: sp.get("q")?.slice(0, 80) ?? undefined, kind: sp.get("kind") ?? undefined, limit: pageSize, offset });
  return { items, total, page, pageSize };
});
