import "server-only";
import { tx } from "@/lib/db";
import { z } from "zod";
import { runStructured } from "@/lib/ai/run";
import { getDestination } from "@/lib/catalog/destinations";
import { badRequest, conflict, notFound, type Actor } from "@/lib/http";
import { computeBudget, planTransport, selectHotel, tripDays } from "@/lib/itinerary/budget";
import { addDays } from "@/lib/planner/rules-extractor";
import { run } from "@/lib/db";
import { EditError, alternativesFor, applyEdit, type ItineraryEdit } from "@/lib/itinerary/edit";
import { buildItinerary, isSuitable, itineraryInputHash, planDaysDeterministic, type DayPlan } from "@/lib/itinerary/generate";
import type { Itinerary } from "@/lib/itinerary/types";
import { recordAudit } from "@/lib/repos/audit";
import { getItinerary, insertItinerary, latestItineraryForTrip, nextItineraryVersion, saveItinerary } from "@/lib/repos/itineraries";
import { addLeadActivity, leadForTrip } from "@/lib/repos/leads";
import { getPreferences, getTripRow, updateTrip } from "@/lib/repos/trips";
import { loadTripForActor, syncLead } from "./planner";
import { formatMoney } from "@/lib/planner/profile";

const ITINERARY_SYSTEM = `You are a travel planner choosing activities for a day-by-day itinerary.
Input JSON: profile (customer preferences), days (number of days), candidates (the ONLY activities you may use, with id, title, area, tags, hours, intensity).
Rules:
- Return exactly "days" entries. Use only candidate ids; never invent activities, hotels or prices.
- Day 1 is arrival and the last day is departure: at most one short activity on each.
- Respect pace: relaxed = 1–2 activities/day, balanced = 2, packed = up to 3. Full-day activities (7+ hours) usually stand alone.
- Group activities in the same area on the same day. Prioritise the customer's interests and must-sees.
- Do not repeat an activity. A day may be left free.
- For each chosen activity give a short, specific reason (max 20 words) tied to the customer's preferences.
- summary: one or two sentences describing the trip. Do not mention prices.`;

const ItineraryPlanSchema = z
  .strictObject({
    summary: z.string(),
    days: z.array(
      z.strictObject({
        title: z.string(),
        activityIds: z.array(z.string()),
        reasons: z.array(z.strictObject({ activityId: z.string(), reason: z.string() })),
      }),
    ),
  })
  .transform((v) => ({
    summary: v.summary,
    plans: v.days.map<DayPlan>((d) => ({
      title: d.title,
      activityIds: d.activityIds,
      reasons: Object.fromEntries(d.reasons.map((r) => [r.activityId, r.reason])),
    })),
  }));

export interface GenerateResult {
  itinerary: Itinerary;
  reused: boolean;
  ai: { source: string; notice: string | null };
}

export async function generateItinerary(actor: Actor, tripId: string, opts: { force?: boolean } = {}): Promise<GenerateResult> {
  const trip = loadTripForActor(actor, tripId);
  const prefs = getPreferences(trip.id);
  if (!prefs) throw notFound("Trip preferences not found");
  const p = prefs.profile;
  const d = getDestination(p.destinationId);
  if (!d) throw badRequest("Choose a destination before generating an itinerary");

  // Reuse: unchanged inputs return the saved itinerary with no AI call.
  const latest = latestItineraryForTrip(trip.id);
  if (latest && !opts.force && latest.inputHash === itineraryInputHash(p)) {
    return { itinerary: latest, reused: true, ai: { source: "cache", notice: null } };
  }

  const days = tripDays(p, d);
  const candidates = d.activities
    .filter((a) => isSuitable(a, p))
    .map((a) => ({ id: a.id, title: a.title, area: a.area, tags: a.tags, hours: a.hours, intensity: a.intensity }));
  const outcome = await runStructured({
    actorKey: actor.key,
    category: "itinerary",
    tier: "advanced",
    system: ITINERARY_SYSTEM,
    input: JSON.stringify({
      profile: {
        destination: d.name, days, adults: p.adults, children: p.children, childrenAges: p.childrenAges, tripType: p.tripType,
        occasion: p.occasion, interests: p.interests, pace: p.pace ?? "balanced", mustSee: p.mustSee, dietary: p.dietary,
        accessibility: p.accessibility, month: p.travelMonth,
      },
      days,
      candidates,
    }),
    schema: ItineraryPlanSchema,
    schemaName: "itinerary_plan",
    maxOutputTokens: 1400,
    fallback: () => ({ summary: "", plans: planDaysDeterministic(d, p) }),
  });

  let plans = outcome.value.plans;
  const usable = plans.some((pl) => pl.activityIds.some((id) => candidates.some((c) => c.id === id)));
  if (!usable) plans = planDaysDeterministic(d, p);

  // Itinerary, trip estimate, audit entry and CRM lead are written in one transaction.
  const itinerary = tx(() => {
    const itinerary = insertItinerary(
      buildItinerary({
        tripId: trip.id,
        version: nextItineraryVersion(trip.id),
        destination: d,
        profile: p,
        plans,
        generatedBy: outcome.source === "live" ? `openai:${outcome.model}` : outcome.source === "fallback" ? "deterministic (AI fallback)" : "deterministic (demo mode)",
        summary: outcome.value.summary || null,
      }),
    );
    updateTrip(trip.id, {
      status: trip.status === "planning" || trip.status === "itinerary_ready" ? "itinerary_ready" : undefined,
      estimatedTotal: itinerary.budget.total,
    });
    recordAudit({ userId: actor.userId, label: actor.user?.name ?? "Customer" }, "itinerary", itinerary.id, "generated", undefined, {
      version: itinerary.version,
      total: itinerary.budget.total,
      generatedBy: itinerary.generatedBy,
    });
    const lead = syncLead(actor, trip.id, null, false);
    if (lead) addLeadActivity(lead.id, null, "itinerary_generated", `Itinerary v${itinerary.version} generated: ${itinerary.days.length} days, estimated ${formatMoney(itinerary.budget.total)}.`);
    return itinerary;
  });
  return { itinerary, reused: false, ai: { source: outcome.source, notice: outcome.notice } };
}

export function loadItineraryForActor(actor: Actor, itineraryId: string): Itinerary {
  const it = getItinerary(itineraryId);
  if (!it) throw notFound("Itinerary not found");
  loadTripForActor(actor, it.tripId);
  return it;
}

export function itineraryAlternatives(actor: Actor, itineraryId: string, itemId?: string) {
  const it = loadItineraryForActor(actor, itineraryId);
  const d = getDestination(it.destinationId);
  const prefs = getPreferences(it.tripId);
  if (!d || !prefs) return [];
  try {
    return alternativesFor(it, d, prefs.profile, itemId, 6).map((a) => ({
      id: a.id, title: a.title, area: a.area, hours: a.hours, costPerPerson: a.costPerPerson, tags: a.tags, description: a.description,
    }));
  } catch (e) {
    if (e instanceof EditError) throw notFound(e.message);
    throw e;
  }
}

export function editItinerary(actor: Actor, itineraryId: string, edit: ItineraryEdit) {
  const it = loadItineraryForActor(actor, itineraryId);
  const latest = latestItineraryForTrip(it.tripId);
  if (latest && latest.id !== it.id) throw conflict("A newer version of this itinerary exists. Please reload.");
  const d = getDestination(it.destinationId);
  const prefs = getPreferences(it.tripId);
  if (!d || !prefs) throw notFound("Trip details not found");
  try {
    const { itinerary, description, affectedDays } = applyEdit(it, edit, d, prefs.profile);
    const saved = saveItinerary(itinerary);
    updateTrip(it.tripId, { estimatedTotal: saved.budget.total });
    recordAudit({ userId: actor.userId, label: actor.user?.name ?? "Customer" }, "itinerary", it.id, `edit:${edit.op}`, undefined, { description });
    const lead = leadForTrip(it.tripId);
    if (lead) addLeadActivity(lead.id, null, "itinerary_edited", `${description}. New estimate ${formatMoney(saved.budget.total)}.`);
    return { itinerary: saved, description, affectedDays, trip: getTripRow(it.tripId) };
  } catch (e) {
    if (e instanceof EditError) throw e.code === "not_found" ? notFound(e.message) : badRequest(e.message);
    throw e;
  }
}

/**
 * Re-prices an itinerary after a cost-only preference change (budget, dates,
 * hotel level, flights, party size for rooms) without touching the chosen
 * activities. Pure code — no AI call.
 */
export function refreshItineraryCosts(actor: Actor, tripId: string): { itinerary: Itinerary; description: string } | null {
  loadTripForActor(actor, tripId);
  const it = latestItineraryForTrip(tripId);
  const prefs = getPreferences(tripId);
  if (!it || !prefs) return null;
  const d = getDestination(it.destinationId);
  if (!d) return null;
  const p = prefs.profile;
  const next = structuredClone(it);
  next.hotel = selectHotel(d, p.accommodation ?? it.hotel.tier, p);
  next.transport = planTransport(d, p);
  next.days = next.days.map((day) => ({ ...day, date: p.startDate ? addDays(p.startDate, day.dayNumber - 1) : null }));
  next.budget = computeBudget(d, p, next.days, next.hotel, next.transport);
  next.inputHash = itineraryInputHash(p);
  const saved = saveItinerary(next);
  run("UPDATE itineraries SET input_hash = ? WHERE id = ?", [next.inputHash, it.id]);
  updateTrip(tripId, { estimatedTotal: saved.budget.total });
  const delta = saved.budget.total - it.budget.total;
  return {
    itinerary: saved,
    description: `Re-priced your itinerary: ${formatMoney(saved.budget.total)} total (${delta === 0 ? "no change" : `${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))}`}). ${saved.budget.comparison.note}`,
  };
}

/** Deterministic savings: one hotel level down, and the priciest activity swapped for a cheaper suitable one. */
export function makeItineraryCheaper(actor: Actor, tripId: string): { itinerary: Itinerary; description: string } | null {
  const trip = loadTripForActor(actor, tripId);
  let it = latestItineraryForTrip(trip.id);
  const prefs = getPreferences(trip.id);
  if (!it || !prefs) return null;
  const d = getDestination(it.destinationId);
  if (!d) return null;
  const before = it.budget.total;
  const changes: string[] = [];
  const lower = it.hotel.tier === "luxury" ? "midrange" : it.hotel.tier === "midrange" ? "budget" : null;
  if (lower) {
    it = applyEdit(it, { op: "setHotelTier", tier: lower }, d, prefs.profile).itinerary;
    changes.push(`switched to a ${lower === "budget" ? "budget / 3★" : "comfort / 4★"} stay`);
  }
  const priciest = it.days.flatMap((day) => day.items).filter((i) => i.kind === "activity" && i.estCost > 0).sort((a, b) => b.estCost - a.estCost)[0];
  if (priciest) {
    const current = d.activities.find((a) => a.id === priciest.catalogRef);
    const cheaper = alternativesFor(it, d, prefs.profile, priciest.id, 10)
      .filter((a) => current && a.costPerPerson < current.costPerPerson)
      .sort((a, b) => a.costPerPerson - b.costPerPerson)[0];
    if (cheaper) {
      it = applyEdit(it, { op: "replace", itemId: priciest.id, catalogRef: cheaper.id }, d, prefs.profile).itinerary;
      changes.push(`swapped “${priciest.title}” for “${cheaper.title}”`);
    }
  }
  if (!changes.length) return { itinerary: it, description: "Your itinerary is already at the lowest-cost options in our catalog." };
  const saved = saveItinerary(it);
  updateTrip(trip.id, { estimatedTotal: saved.budget.total });
  recordAudit({ userId: actor.userId, label: actor.user?.name ?? "Customer" }, "itinerary", saved.id, "edit:cheaper", { total: before }, { total: saved.budget.total });
  const lead = leadForTrip(trip.id);
  if (lead) addLeadActivity(lead.id, null, "itinerary_edited", `Customer asked for cheaper options: ${changes.join("; ")}. New estimate ${formatMoney(saved.budget.total)}.`);
  return { itinerary: saved, description: `To save money I ${changes.join(" and ")}. New estimate ${formatMoney(saved.budget.total)} (saves ${formatMoney(before - saved.budget.total)}).` };
}
