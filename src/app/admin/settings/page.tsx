import { Suspense } from "react";
import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { SettingsPage } from "@/components/admin/settings";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "Settings" };

export default async function Page() {
  const user = await getServerUser();
  if (!(can(user?.role, "dashboard:read"))) return <ForbiddenPanel area="settings" />;
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
