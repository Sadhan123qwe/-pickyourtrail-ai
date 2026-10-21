import { Suspense } from "react";
import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { LeadsCRM } from "@/components/admin/leads-crm";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "Leads & CRM" };

export default async function LeadsPage() {
  const user = await getServerUser();
  if (!can(user?.role, "leads:read")) return <ForbiddenPanel area="sales leads" />;
  return (
    <Suspense>
      <LeadsCRM canWrite={can(user?.role, "leads:write")} />
    </Suspense>
  );
}
