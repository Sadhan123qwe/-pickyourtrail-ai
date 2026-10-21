import { Suspense } from "react";
import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { Customers } from "@/components/admin/customers";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "Customers" };

export default async function Page() {
  const user = await getServerUser();
  if (!(can(user?.role, "leads:read") || can(user?.role, "tickets:read"))) return <ForbiddenPanel area="customers" />;
  return (
    <Suspense>
      <Customers />
    </Suspense>
  );
}
