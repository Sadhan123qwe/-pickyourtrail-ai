import { Suspense } from "react";
import { getServerUser } from "@/lib/auth/server";
import { can } from "@/lib/auth/permissions";
import { BookingOperations } from "@/components/admin/bookings";
import { ForbiddenPanel } from "@/components/admin/forbidden";

export const metadata = { title: "Booking operations" };

export default async function BookingsPage() {
  const user = await getServerUser();
  if (!can(user?.role, "trips:read_all")) return <ForbiddenPanel area="booking operations" />;
  return (
    <Suspense>
      <BookingOperations canWrite={can(user?.role, "trips:write_ops")} />
    </Suspense>
  );
}
