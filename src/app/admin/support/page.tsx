import { Suspense } from "react";
import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { SupportOps } from "@/components/admin/support-ops";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "Support operations" };

export default async function SupportOpsPage() {
  const user = await getServerUser();
  if (!can(user?.role, "tickets:read")) return <ForbiddenPanel area="support tickets" />;
  return (
    <Suspense>
      <SupportOps canWrite={can(user?.role, "tickets:write")} />
    </Suspense>
  );
}
