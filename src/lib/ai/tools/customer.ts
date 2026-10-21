import "server-only";
import { z } from "zod";
import { ownsRecord } from "@/lib/auth/permissions";
import { INTERESTS } from "@/lib/catalog/types";
import { ItineraryEditSchema } from "@/lib/itinerary/edit";
import { applyManualEdit, nextField } from "@/lib/planner/engine";
import { TripProfileSchema, formatMoney } from "@/lib/planner/profile";
import { recommendDestinations } from "@/lib/planner/recommend";
import { latestItineraryForTrip } from "@/lib/repos/itineraries";
import { searchKnowledge } from "@/lib/repos/knowledge";
import { getPreferences, savePlannerState } from "@/lib/repos/trips";
import { listTicketsForOwner } from "@/lib/repos/tickets";
import { editItinerary, generateItinerary, makeItineraryCheaper, refreshItineraryCosts } from "@/lib/services/itinerary";
import { loadTripForActor, syncLead } from "@/lib/services/planner";
import { createSupportTicket } from "@/lib/services/support";
import { requestBookingHandoff, updateTripAsOwner } from "@/lib/services/trips";
import { defineTool, ToolError, type RecordRef } from "./types";

/**
 * Customer-facing tools. They act only on records the customer owns and are
 * reversible (preferences, itinerary drafts, saving). The one consequential
 * action — create_booking_handoff — requires explicit confirmation: the AI can
 * only propose it, and the customer confirms on the review page.
 */

const tripId = z.string().min(3).max(64);
const anyone = () => true;

function ownTrip(ctx: { actor: Parameters<typeof loadTripForActor>[0] }, id: string) {
  const trip = loadTripForActor(ctx.actor, id);
  if (!ownsRecord(ctx.actor, trip)) throw new ToolError("Only the trip owner can change this trip", "forbidden");
  return trip;
}

const itineraryRef = (trip: { id: string; title: string }, version: number): RecordRef => ({ type: "itinerary", id: trip.id, label: `${trip.title} · itinerary v${version}`, href: `/trips/${trip.id}/itinerary` });

export const customerTools = [
  defineTool({
    name: "get_trip_profile",
    description: "Read the structured trip profile.",
    audience: "customer",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ tripId }),
    authorize: anyone,
    run: (ctx, args) => {
      const trip = loadTripForActor(ctx.actor, args.tripId);
      const prefs = getPreferences(trip.id)!;
      return { summary: `Trip profile for ${trip.title}.`, records: [{ type: "trip", id: trip.id, label: trip.title }], data: prefs.profile };
    },
  }),
  defineTool({
    name: "update_trip_preferences",
    description: "Apply structured changes to the trip profile.",
    audience: "customer",
    kind: "write",
    requiresConfirmation: false,
    args: z.object({ tripId, updates: TripProfileSchema.partial() }),
    authorize: anyone,
    run: (ctx, args) => {
      const trip = ownTrip(ctx, args.tripId);
      const prefs = getPreferences(trip.id)!;
      const state = applyManualEdit({ profile: prefs.profile, status: prefs.status, lastQuestion: prefs.lastQuestion }, args.updates);
      state.lastQuestion = nextField(state.profile, state.status) ?? "review";
      savePlannerState(trip.id, state, prefs.version);
      return { summary: "Trip preferences updated.", records: [{ type: "trip", id: trip.id, label: trip.title }] };
    },
  }),
  defineTool({
    name: "search_destinations",
    description: "Recommend destinations from the catalog for interests, month and budget.",
    audience: "customer",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ tripId: tripId.optional(), interests: z.array(z.enum(INTERESTS)).optional() }),
    authorize: anyone,
    run: (ctx, args) => {
      const profile = args.tripId ? getPreferences(loadTripForActor(ctx.actor, args.tripId).id)!.profile : TripProfileSchema.parse({ ...emptyLike(), interests: args.interests ?? [] });
      const recs = recommendDestinations(profile);
      return { summary: `Top matches: ${recs.map((r) => r.name).join(", ")}.`, records: [], data: recs };
    },
  }),
  defineTool({
    name: "generate_itinerary",
    description: "Generate (or regenerate) the day-by-day itinerary from the trip profile.",
    audience: "customer",
    kind: "write",
    requiresConfirmation: false,
    args: z.object({ tripId, force: z.boolean().optional() }),
    authorize: anyone,
    run: async (ctx, args) => {
      const trip = ownTrip(ctx, args.tripId);
      const r = await generateItinerary(ctx.actor, trip.id, { force: args.force });
      return {
        summary: r.reused ? "Preferences unchanged — kept the saved itinerary." : `Generated itinerary v${r.itinerary.version}: ${r.itinerary.days.length} days, estimated ${formatMoney(r.itinerary.budget.total)}.`,
        records: [itineraryRef(trip, r.itinerary.version)],
        data: { itineraryId: r.itinerary.id, total: r.itinerary.budget.total, version: r.itinerary.version, aiSource: r.ai.source },
      };
    },
  }),
  defineTool({
    name: "update_itinerary",
    description: "Apply one itinerary edit (remove, replace, move, add, regenerate a day, hotel tier).",
    audience: "customer",
    kind: "write",
    requiresConfirmation: false,
    args: z.object({ tripId, edit: ItineraryEditSchema }),
    authorize: anyone,
    run: (ctx, args) => {
      const trip = ownTrip(ctx, args.tripId);
      const it = latestItineraryForTrip(trip.id);
      if (!it) throw new ToolError("There's no itinerary yet", "not_found");
      const r = editItinerary(ctx.actor, it.id, args.edit);
      return { summary: `${r.description}. New estimate ${formatMoney(r.itinerary.budget.total)}.`, records: [itineraryRef(trip, r.itinerary.version)], data: { itineraryId: r.itinerary.id, total: r.itinerary.budget.total } };
    },
  }),
  defineTool({
    name: "calculate_trip_budget",
    description: "Re-price the itinerary after cost-related preference changes (no activity changes).",
    audience: "customer",
    kind: "write",
    requiresConfirmation: false,
    args: z.object({ tripId }),
    authorize: anyone,
    run: (ctx, args) => {
      const trip = ownTrip(ctx, args.tripId);
      const r = refreshItineraryCosts(ctx.actor, trip.id);
      if (!r) throw new ToolError("There's no itinerary to price yet", "not_found");
      return { summary: r.description, records: [itineraryRef(trip, r.itinerary.version)], data: { itineraryId: r.itinerary.id, total: r.itinerary.budget.total } };
    },
  }),
  defineTool({
    name: "make_itinerary_cheaper",
    description: "Lower the cost: cheaper hotel level and a cheaper alternative for the priciest activity.",
    audience: "customer",
    kind: "write",
    requiresConfirmation: false,
    args: z.object({ tripId }),
    authorize: anyone,
    run: (ctx, args) => {
      const trip = ownTrip(ctx, args.tripId);
      const r = makeItineraryCheaper(ctx.actor, trip.id);
      if (!r) throw new ToolError("There's no itinerary yet", "not_found");
      return { summary: r.description, records: [itineraryRef(trip, r.itinerary.version)], data: { itineraryId: r.itinerary.id, total: r.itinerary.budget.total } };
    },
  }),
  defineTool({
    name: "save_trip",
    description: "Save the trip to My Trips.",
    audience: "customer",
    kind: "write",
    requiresConfirmation: false,
    args: z.object({ tripId }),
    authorize: anyone,
    run: (ctx, args) => {
      const trip = ownTrip(ctx, args.tripId);
      if (!["planning", "itinerary_ready"].includes(trip.status)) return { summary: "Your trip is already saved.", records: [{ type: "trip", id: trip.id, label: trip.title, href: "/trips" }] };
      const t = updateTripAsOwner(ctx.actor, trip.id, { status: "saved" });
      return { summary: "Saved to My Trips.", records: [{ type: "trip", id: t.id, label: t.title, href: "/trips" }] };
    },
  }),
  defineTool({
    name: "create_or_update_lead",
    description: "Create or refresh the sales lead for this planning session (idempotent).",
    audience: "customer",
    kind: "write",
    requiresConfirmation: false,
    args: z.object({ tripId }),
    authorize: anyone,
    run: (ctx, args) => {
      const trip = loadTripForActor(ctx.actor, args.tripId);
      const lead = syncLead(ctx.actor, trip.id, null, false);
      return { summary: lead ? "Lead is up to date." : "Not enough detail for a lead yet.", records: [] };
    },
  }),
  defineTool({
    name: "get_customer_support_context",
    description: "The customer's own open support tickets.",
    audience: "customer",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({}),
    authorize: anyone,
    run: (ctx) => {
      const tickets = listTicketsForOwner(ctx.actor).filter((t) => !["closed"].includes(t.status));
      return { summary: `${tickets.length} ticket(s).`, records: tickets.map((t) => ({ type: "ticket" as const, id: t.id, label: `${t.ref} · ${t.subject}`, href: `/support/tickets/${t.id}` })), data: tickets.map((t) => ({ ref: t.ref, status: t.status })) };
    },
  }),
  defineTool({
    name: "create_support_ticket",
    description: "Open a support ticket for the customer (triaged automatically).",
    audience: "customer",
    kind: "write",
    requiresConfirmation: false,
    args: z.object({ message: z.string().min(5).max(4000), tripId: tripId.optional(), idempotencyKey: z.string().min(8).max(80).optional() }),
    authorize: anyone,
    run: (ctx, args) => {
      const r = createSupportTicket({ actor: ctx.actor, message: args.message, tripId: args.tripId ?? null, idempotencyKey: args.idempotencyKey ?? null });
      return { summary: `Ticket ${r.ticket.ref} created (${r.ticket.priority} priority).`, records: [{ type: "ticket", id: r.ticket.id, label: r.ticket.ref, href: `/support/tickets/${r.ticket.id}` }] };
    },
  }),
  defineTool({
    name: "edit_itinerary",
    description: "Edit the customer's itinerary (remove, replace, move, add an activity, regenerate one day, change hotel tier); totals are recalculated in code.",
    audience: "customer",
    kind: "write",
    requiresConfirmation: false,
    args: z.object({ tripId, edit: ItineraryEditSchema }),
    authorize: anyone,
    run: (ctx, args) => {
      const trip = ownTrip(ctx, args.tripId);
      const it = latestItineraryForTrip(trip.id);
      if (!it) throw new ToolError("There's no itinerary yet", "not_found");
      const r = editItinerary(ctx.actor, it.id, args.edit);
      return { summary: `${r.description}. New estimate ${formatMoney(r.itinerary.budget.total)}.`, records: [itineraryRef(trip, r.itinerary.version)], data: { itineraryId: r.itinerary.id, total: r.itinerary.budget.total } };
    },
  }),
  defineTool({
    name: "create_booking_handoff",
    description: "Send the trip to a travel expert for a quote (nothing is booked or charged). Requires the customer's explicit confirmation.",
    audience: "customer",
    kind: "write",
    requiresConfirmation: true,
    args: z.object({
      tripId,
      contactName: z.string().trim().min(2).max(80),
      contactEmail: z.email().max(120),
      contactPhone: z.string().trim().max(20).optional().nullable(),
      notes: z.string().trim().max(1000).optional().nullable(),
      idempotencyKey: z.string().min(8).max(80),
    }),
    authorize: anyone,
    describe: (ctx, args) => {
      const trip = ownTrip(ctx, args.tripId);
      if (!latestItineraryForTrip(trip.id)) throw new ToolError("Generate an itinerary before requesting a quote", "invalid_arguments");
      return { description: `Send “${trip.title}” to a travel expert for a quote, contacting ${args.contactName} at ${args.contactEmail}. Nothing will be booked or charged.`, records: [{ type: "trip", id: trip.id, label: trip.title, href: `/trips/${trip.id}/review` }] };
    },
    run: async (ctx, args) => {
      const trip = ownTrip(ctx, args.tripId);
      const r = await requestBookingHandoff(ctx.actor, { ...args, confirm: true });
      return {
        summary: r.duplicate ? r.message : `Quote request sent for “${trip.title}”. Booking status: not confirmed — a travel expert will reply.`,
        records: [{ type: "trip", id: trip.id, label: trip.title, href: `/trips/${trip.id}/review` }],
        data: { handoffId: r.handoff.id, opsStatus: r.handoff.ops_status, providerStatus: r.handoff.provider_status },
      };
    },
  }),
  defineTool({
    name: "search_public_knowledge",
    description: "Search public help articles.",
    audience: "customer",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ query: z.string().min(2).max(300) }),
    authorize: anyone,
    run: (_ctx, args) => {
      const hits = searchKnowledge(args.query, { includeInternal: false, limit: 3 });
      return { summary: `${hits.length} article(s).`, records: hits.map((h) => ({ type: "document" as const, id: h.id, label: h.title })), data: hits };
    },
  }),
];

function emptyLike() {
  return {
    destinationId: null, destinationName: null, destinationOpen: true, departureCity: null, startDate: null, endDate: null, travelMonth: null,
    dateFlexibility: null, durationDays: null, adults: null, children: null, childrenAges: [], tripType: null, occasion: null, interests: [],
    pace: null, budgetAmount: null, currency: "INR", budgetScope: null, budgetIncludesFlights: null, accommodation: null, needsFlights: null,
    flightClass: null, dietary: [], accessibility: null, mustSee: [], specialRequests: null,
  };
}
