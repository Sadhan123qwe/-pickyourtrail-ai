import { ItineraryView } from "@/components/itinerary/itinerary-view";

export const metadata = { title: "Itinerary" };

export default async function ItineraryPage(props: PageProps<"/trips/[id]/itinerary">) {
  const { id } = await props.params;
  return <ItineraryView tripId={id} />;
}
