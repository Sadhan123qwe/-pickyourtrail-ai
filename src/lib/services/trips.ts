import "server-only";
import { ownsRecord } from "@/lib/auth/permissions";
import { badRequest, conflict, forbidden, type Actor } from "@/lib/http";
import { getBookingProvider } from "@/lib/providers/booking";
import { recordAudit } from "@/lib/repos/audit";
import { getHandoffByKey, insertHandoff, latestHandoffForTrip } from "@/lib/repos/handoffs";
import { latestItineraryForTrip } from "@/lib/repos/itineraries";
import { addLeadActivity } from "@/lib/repos/leads";
import { duplicateTrip, getTripRow, updateTrip, type TripRow, type TripStatus } from "@/lib/repos/trips";
import { createConversation } from "@/lib/repos/conversations";
import { loadTripForActor, syncLead } from "./planner";
import { formatMoney } from "@/lib/planner/profile";

/** Status changes a customer may make themselves. */
const CUSTOMER_TRANSITIONS: Partial<Record<TripStatus, TripStatus[]>> = {
  planning: ["saved", "cancelled"],
  itinerary_ready: ["saved", "cancelled"],
  saved: ["cancelled"],
  handoff_requested: ["cancelled"],
};

export function updateTripAsOwner(
  actor: Actor,
  tripId: string,
  patch: { title?: string; status?: "saved" | "cancelled"; contact?: { name?: string; email?: string; phone?: string } },
): TripRow {
  const trip = loadTripForActor(actor, tripId);
  if (!ownsRecord(actor, trip)) throw forbidden("Only the trip owner can change this trip");
  if (patch.status && patch.status !== trip.status) {
    if (!CUSTOMER_TRANSITIONS[trip.status]?.includes(patch.status)) {
      throw badRequest(`A ${trip.status.replace("_", " ")} trip can't be changed to ${patch.status}`);
    }
  }
  updateTrip(trip.id, { title: patch.title, status: patch.status === trip.status ? undefined : patch.status });
  recordAudit({ userId: actor.userId, label: actor.user?.name ?? "Customer" }, "trip", trip.id, "updated", { status: trip.status, title: trip.title }, patch);
  if (patch.status === "saved" || patch.contact) {
    const lead = syncLead(actor, trip.id, null, false, patch.contact);
    if (lead && patch.status === "saved") addLeadActivity(lead.id, null, "trip_saved", "Customer saved the trip.");
  }
  return getTripRow(trip.id)!;
}

export function duplicateTripAsOwner(actor: Actor, tripId: string): TripRow {
  const trip = loadTripForActor(actor, tripId);
  if (!ownsRecord(actor, trip)) throw forbidden("Only the trip owner can duplicate this trip");
  const copy = duplicateTrip(actor, trip.id);
  createConversation(actor, "planner", copy.id);
  return copy;
}

export async function requestBookingHandoff(
  actor: Actor,
  input: { tripId: string; contactName: string; contactEmail: string; contactPhone?: string | null; notes?: string | null; confirm: true; idempotencyKey: string },
) {
  const trip = loadTripForActor(actor, input.tripId);
  if (!ownsRecord(actor, trip)) throw forbidden("Only the trip owner can request a booking");
  const existing = getHandoffByKey(input.idempotencyKey);
  if (existing) {
    if (existing.trip_id !== trip.id) throw conflict("This request key was already used for another trip");
    return { handoff: existing, duplicate: true, message: "We already received this booking request." };
  }
  if (trip.status === "cancelled") throw badRequest("This trip was cancelled");
  const open = latestHandoffForTrip(trip.id);
  if (open && !["failed", "cancelled"].includes(open.ops_status)) {
    return { handoff: open, duplicate: true, message: "A booking request for this trip is already with our travel experts." };
  }
  const itinerary = latestItineraryForTrip(trip.id);
  if (!itinerary) throw badRequest("Generate an itinerary before requesting a booking");

  const provider = getBookingProvider();
  const result = await provider.submit({ handoffId: input.idempotencyKey, tripId: trip.id, itineraryId: itinerary.id, totalEstimate: itinerary.budget.total });
  const confirmationText = `I confirm I want a travel expert to check availability for "${trip.title}" (estimated ${formatMoney(itinerary.budget.total)}) and send me a final quote. I understand nothing is booked or charged yet.`;
  const handoff = insertHandoff({
    tripId: trip.id,
    itineraryId: itinerary.id,
    requestedByUserId: actor.userId,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone ?? null,
    notes: input.notes ?? null,
    confirmationText,
    idempotencyKey: input.idempotencyKey,
    provider: provider.name,
    result,
  });
  // A trip is only "booked" when a provider returns a confirmation reference.
  const booked = result.providerStatus === "provider_confirmed" && !!result.providerReference;
  updateTrip(trip.id, { status: booked ? "booked" : "handoff_requested" });
  recordAudit({ userId: actor.userId, label: actor.user?.name ?? input.contactName }, "booking_handoff", handoff.id, "requested", undefined, {
    providerStatus: result.providerStatus,
    provider: provider.name,
  });
  const lead = syncLead(actor, trip.id, null, false, { name: input.contactName, email: input.contactEmail, phone: input.contactPhone ?? null });
  if (lead) addLeadActivity(lead.id, null, "handoff_requested", `Customer requested a booking (handoff to travel experts). Provider status: ${result.providerStatus}.`);
  return { handoff, duplicate: false, message: result.message };
}
