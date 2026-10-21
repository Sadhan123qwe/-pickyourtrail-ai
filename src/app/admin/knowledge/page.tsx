import { Suspense } from "react";
import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { KnowledgeBase } from "@/components/admin/knowledge";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "Knowledge base" };

export default async function Page() {
  const user = await getServerUser();
  if (!(can(user?.role, "copilot:use"))) return <ForbiddenPanel area="the knowledge base" />;
  return (
    <Suspense>
      <KnowledgeBase />
    </Suspense>
  );
}
