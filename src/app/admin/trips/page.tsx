import { Suspense } from "react";
import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { TripsAdmin } from "@/components/admin/trips-admin";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "Trips & itineraries" };

export default async function TripsAdminPage() {
  const user = await getServerUser();
  if (!can(user?.role, "trips:read_all")) return <ForbiddenPanel area="trips" />;
  return (
    <Suspense>
      <TripsAdmin />
    </Suspense>
  );
}
