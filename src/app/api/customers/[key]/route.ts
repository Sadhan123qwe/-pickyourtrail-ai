import { forbidden, notFound, requireUser, route } from "@/lib/http";
import { can } from "@/lib/auth/permissions";
import { getCustomer } from "@/lib/repos/customers";

export const GET = route<{ key: string }>({}, ({ actor, params }) => {
  const user = requireUser(actor);
  if (!can(user.role, "leads:read") && !can(user.role, "tickets:read")) throw forbidden();
  const c = getCustomer(decodeURIComponent(params.key));
  if (!c) throw notFound("Customer not found");
  // Each section is only returned to roles allowed to see it.
  return {
    customer: c.customer,
    trips: c.trips,
    leads: can(user.role, "leads:read") ? c.leads : null,
    tickets: can(user.role, "tickets:read") ? c.tickets : null,
    conversations: c.conversations,
  };
});
