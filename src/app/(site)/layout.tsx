import { getServerUser } from "@/lib/auth/server";
import { CustomerShell } from "@/components/customer/shell";

/** Customer workspace: navy sidebar (Explore · AI Trip Planner · My Trips · Support · Profile). */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerUser();
  return <CustomerShell user={user ? { name: user.name, email: user.email, role: user.role } : null}>{children}</CustomerShell>;
}
