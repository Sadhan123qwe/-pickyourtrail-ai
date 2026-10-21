import { route } from "@/lib/http";
import { itineraryAlternatives } from "@/lib/services/itinerary";

/** Suitable unused catalog activities, optionally ranked as replacements for one item. */
export const GET = route<{ id: string }>({}, ({ req, actor, params }) => {
  const itemId = req.nextUrl.searchParams.get("itemId") ?? undefined;
  return { items: itineraryAlternatives(actor, params.id, itemId) };
});
