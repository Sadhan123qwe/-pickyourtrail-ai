import { Suspense } from "react";
import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { Copilot } from "@/components/admin/copilot";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "Employee AI Copilot" };

export default async function CopilotPage() {
  const user = await getServerUser();
  if (!user || !can(user.role, "copilot:use")) return <ForbiddenPanel area="the Employee AI Copilot" />;
  return (
    <Suspense>
      <Copilot userName={user.name} />
    </Suspense>
  );
}
