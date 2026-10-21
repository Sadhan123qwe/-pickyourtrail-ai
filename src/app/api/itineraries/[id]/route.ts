import { forbidden, parseBody, route } from "@/lib/http";
import { ownsRecord } from "@/lib/auth/permissions";
import { ItineraryEditSchema } from "@/lib/itinerary/edit";
import { getTripRow } from "@/lib/repos/trips";
import { editItinerary, loadItineraryForActor } from "@/lib/services/itinerary";

export const GET = route<{ id: string }>({}, ({ actor, params }) => {
  const itinerary = loadItineraryForActor(actor, params.id);
  return { itinerary, trip: getTripRow(itinerary.tripId) };
});

/** Deterministic edits: remove, replace, move, add, regenerate one day, change hotel tier. */
export const PATCH = route<{ id: string }>({}, async ({ req, actor, params }) => {
  const itinerary = loadItineraryForActor(actor, params.id);
  const trip = getTripRow(itinerary.tripId)!;
  if (!ownsRecord(actor, trip)) throw forbidden("Only the trip owner can edit this itinerary");
  const edit = await parseBody(req, ItineraryEditSchema);
  return editItinerary(actor, params.id, edit);
});
