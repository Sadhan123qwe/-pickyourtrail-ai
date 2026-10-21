import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { Analytics } from "@/components/admin/analytics";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "Analytics & reports" };

export default async function AnalyticsPage() {
  const user = await getServerUser();
  if (!can(user?.role, "analytics:read")) return <ForbiddenPanel area="analytics" />;
  return <Analytics isAdmin={can(user?.role, "settings:manage")} />;
}
