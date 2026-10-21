import { Suspense } from "react";
import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { CommandCenter } from "@/components/admin/command-center";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "AI Command Center" };

export default async function CommandCenterPage() {
  const user = await getServerUser();
  if (!user || !can(user.role, "copilot:use")) return <ForbiddenPanel area="the AI Command Center" />;
  return (
    <Suspense>
      <CommandCenter userName={user.name} />
    </Suspense>
  );
}
