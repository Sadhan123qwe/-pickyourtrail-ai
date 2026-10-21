import type { CatalogActivity, Destination, HotelTier } from "@/lib/catalog/types";
import { DEMO_FX_TO_INR, type TripProfile } from "@/lib/planner/profile";
import type { BudgetBreakdown, HotelSelection, ItineraryDay, TransportPlan } from "./types";

/**
 * Pure, deterministic cost arithmetic. Every number here is an ESTIMATE from
 * demo catalog data; the UI labels it as such. No AI is involved.
 */

export const CABIN_MULTIPLIER = { economy: 1, premium_economy: 1.7, business: 3.2 } as const;
const CHILD_FLIGHT_FACTOR = 0.75;
const INFANT_FLIGHT_FACTOR = 0.1;
const CHILD_MEAL_FACTOR = 0.6;

export interface PartyComposition {
  adults: number;
  children: number; // aged 2–17
  infants: number; // under 2
  total: number;
}

export function party(p: TripProfile): PartyComposition {
  const adults = p.adults ?? 2;
  const childCount = p.children ?? 0;
  const knownInfants = p.childrenAges.filter((a) => a < 2).length;
  const infants = Math.min(knownInfants, childCount);
  return { adults, children: childCount - infants, infants, total: adults + childCount };
}

export function tripDays(p: TripProfile, d: Destination): number {
  return Math.max(1, p.durationDays ?? d.idealDays[0]);
}

export function roomsNeeded(pc: PartyComposition): number {
  return Math.max(Math.ceil(pc.adults / 2), Math.ceil(pc.total / 4), 1);
}

export function vehiclesNeeded(pc: PartyComposition): number {
  return Math.max(1, Math.ceil(pc.total / 6));
}

/** Group cost of one activity in INR. Infants are free. */
export function activityGroupCost(a: CatalogActivity, pc: PartyComposition): number {
  const child = a.childCost ?? Math.round(a.costPerPerson * 0.7);
  return a.costPerPerson * pc.adults + child * pc.children;
}

export function selectHotel(d: Destination, tier: HotelTier, p: TripProfile): HotelSelection {
  const pc = party(p);
  const hotel = d.hotels.find((h) => h.tier === tier) ?? d.hotels[1] ?? d.hotels[0];
  const nights = Math.max(tripDays(p, d) - 1, 1);
  const rooms = roomsNeeded(pc);
  return {
    tier: hotel.tier,
    name: hotel.name,
    area: hotel.area,
    highlights: hotel.highlights,
    nightlyRate: hotel.nightlyRate,
    rooms,
    nights,
    total: hotel.nightlyRate * rooms * nights,
    alternatives: d.hotels.filter((h) => h.tier !== hotel.tier).map((h) => ({ tier: h.tier, name: h.name, nightlyRate: h.nightlyRate })),
  };
}

export function planTransport(d: Destination, p: TripProfile): TransportPlan {
  const pc = party(p);
  const days = tripDays(p, d);
  const cabin = p.flightClass ?? "economy";
  const included = p.needsFlights !== false;
  const perAdult = Math.round(d.flightEconomyPerPerson * CABIN_MULTIPLIER[cabin]);
  const flightsTotal = included
    ? Math.round(perAdult * (pc.adults + pc.children * CHILD_FLIGHT_FACTOR + pc.infants * INFANT_FLIGHT_FACTOR))
    : 0;
  const vehicles = vehiclesNeeded(pc);
  return {
    flights: {
      included,
      cabin,
      from: p.departureCity,
      to: d.arrivalAirport,
      perAdult,
      total: flightsTotal,
      note: included
        ? `Estimated return ${cabin.replace("_", " ")} fare${p.departureCity ? ` from ${p.departureCity}` : " from a major Indian city"}. Not a live fare.`
        : "You'll book flights yourself, so they're excluded.",
    },
    local: {
      perDay: d.localTransportPerDay,
      vehicles,
      days,
      total: d.localTransportPerDay * vehicles * days,
      note: `Private transfers and day-trip transport (${vehicles} vehicle${vehicles > 1 ? "s" : ""}).`,
    },
  };
}

export function budgetInInr(p: TripProfile, travellers: number): number | null {
  if (p.budgetAmount === null) return null;
  const inr = p.budgetAmount * DEMO_FX_TO_INR[p.currency];
  return Math.round(p.budgetScope === "per_person" ? inr * travellers : inr);
}

export function computeBudget(
  d: Destination,
  p: TripProfile,
  days: ItineraryDay[],
  hotel: HotelSelection,
  transport: TransportPlan,
): BudgetBreakdown {
  const pc = party(p);
  const dayCount = tripDays(p, d);
  const activities = days.reduce((sum, day) => sum + day.items.reduce((s, i) => s + i.estCost, 0), 0);
  const meals = Math.round(d.mealsPerPersonPerDay * dayCount * (pc.adults + pc.children * CHILD_MEAL_FACTOR));
  const total = transport.flights.total + hotel.total + activities + transport.local.total + meals;
  const assumptions: string[] = [];
  if (p.adults === null) assumptions.push("Assumed 2 adults because the number of travellers wasn't specified.");
  if (p.durationDays === null) assumptions.push(`Assumed ${dayCount} days, a typical length for ${d.name}.`);
  if (p.currency !== "INR") assumptions.push(`Converted your ${p.currency} budget using a fixed demo exchange rate.`);
  assumptions.push("All prices are estimates from demo data, not live fares, rates or availability.");

  const budgetInr = budgetInInr(p, pc.total);
  const comparableTotal = p.budgetIncludesFlights === false ? total - transport.flights.total : total;
  let comparison: BudgetBreakdown["comparison"];
  if (budgetInr === null) {
    comparison = { status: "unknown", budgetInr: null, comparableTotal, difference: null, note: "No budget given, so there's nothing to compare against." };
  } else {
    const difference = budgetInr - comparableTotal;
    const ratio = comparableTotal / budgetInr;
    const status = ratio <= 0.95 ? "under" : ratio <= 1.08 ? "near" : "over";
    const scope = p.budgetIncludesFlights === false ? " (excluding flights)" : "";
    comparison = {
      status,
      budgetInr,
      comparableTotal,
      difference,
      note:
        status === "over"
          ? `About ${Math.round((ratio - 1) * 100)}% over your budget${scope}. Try a lower hotel tier or fewer paid activities.`
          : status === "near"
            ? `Right around your budget${scope}.`
            : `Within your budget${scope}, leaving some room for shopping and extras.`,
    };
  }
  return {
    currency: "INR",
    flights: transport.flights.total,
    accommodation: hotel.total,
    activities,
    localTransport: transport.local.total,
    meals,
    total,
    perPerson: Math.round(total / pc.total),
    travellers: pc.total,
    comparison,
    assumptions,
  };
}
