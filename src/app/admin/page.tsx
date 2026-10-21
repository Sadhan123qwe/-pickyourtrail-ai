import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server";
import { AdminOverview } from "@/components/admin/overview";

export const metadata = { title: "Business overview" };

export default async function AdminPage() {
  const user = await getServerUser();
  if (!user) redirect("/login?next=/admin");
  return <AdminOverview name={user.name} />;
}
