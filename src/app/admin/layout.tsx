import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server";
import { PERMISSIONS, ROLE_LABELS, can, isEmployee } from "@/lib/auth/permissions";
import { getAiConfig } from "@/lib/config";
import { WorkspaceShell } from "@/components/workspace/shell";

export const metadata = { title: { default: "Operations", template: "%s · Pickyourtrail Operations" } };

/** Server-side gate: only employees may load the operations workspace. Every API re-checks permissions. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerUser();
  if (!user) redirect("/login?next=/admin");
  if (!isEmployee(user.role)) redirect("/login?next=/admin&reason=employee");
  return (
    <WorkspaceShell
      user={{ name: user.name, email: user.email }}
      roleLabel={ROLE_LABELS[user.role]}
      permissions={PERMISSIONS.filter((p) => can(user.role, p))}
      aiMode={getAiConfig().mode}
    >
      {children}
    </WorkspaceShell>
  );
}
