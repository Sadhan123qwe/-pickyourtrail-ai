import { getServerUser } from "@/lib/auth/server";
import { MyTrips } from "@/components/trips/my-trips";

export const metadata = { title: "My trips" };

export default async function TripsPage() {
  const user = await getServerUser();
  return <MyTrips signedIn={!!user} />;
}
