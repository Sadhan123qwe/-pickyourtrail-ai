import { describe, expect, it } from "vitest";
import { getDestination } from "@/lib/catalog/destinations";
import { activityGroupCost, computeBudget, party, planTransport, roomsNeeded, selectHotel } from "@/lib/itinerary/budget";
import { applyEdit, alternativesFor, EditError } from "@/lib/itinerary/edit";
import { buildItinerary, itineraryInputHash, planDaysDeterministic } from "@/lib/itinerary/generate";
import { emptyProfile, type TripProfile } from "@/lib/planner/profile";

const bali = getDestination("bali")!;

function profile(over: Partial<TripProfile> = {}): TripProfile {
  return { ...emptyProfile(), destinationId: "bali", destinationName: "Bali", durationDays: 5, adults: 2, children: 0, ...over };
}

function build(p: TripProfile) {
  return buildItinerary({ tripId: "trip_test", version: 1, destination: bali, profile: p, plans: planDaysDeterministic(bali, p), generatedBy: "test" });
}

describe("budget calculations", () => {
  it("prices children and infants correctly", () => {
    const p = profile({ adults: 2, children: 2, childrenAges: [1, 8] });
    const pc = party(p);
    expect(pc).toEqual({ adults: 2, children: 1, infants: 1, total: 4 });
    const waterbom = bali.activities.find((a) => a.id === "bali-waterbom")!;
    expect(activityGroupCost(waterbom, pc)).toBe(3600 * 2 + 2600); // infant free
  });

  it("computes rooms, hotel nights and totals deterministically", () => {
    expect(roomsNeeded({ adults: 3, children: 0, infants: 0, total: 3 })).toBe(2);
    expect(roomsNeeded({ adults: 2, children: 3, infants: 0, total: 5 })).toBe(2);
    const p = profile();
    const hotel = selectHotel(bali, "midrange", p);
    expect(hotel.nights).toBe(4);
    expect(hotel.total).toBe(7500 * 1 * 4);
    const it = build(p);
    const b = it.budget;
    expect(b.total).toBe(b.flights + b.accommodation + b.activities + b.localTransport + b.meals);
    expect(b.perPerson).toBe(Math.round(b.total / 2));
  });

  it("compares against budget with scope, currency and flight rules", () => {
    const p = profile({ budgetAmount: 1000, currency: "USD", budgetScope: "per_person", budgetIncludesFlights: false });
    const it = build(p);
    expect(it.budget.comparison.budgetInr).toBe(1000 * 84 * 2);
    expect(it.budget.comparison.comparableTotal).toBe(it.budget.total - it.budget.flights);
    const tight = build(profile({ budgetAmount: 50000, budgetScope: "total" }));
    expect(tight.budget.comparison.status).toBe("over");
  });

  it("excludes flights when the customer books them", () => {
    const t = planTransport(bali, profile({ needsFlights: false }));
    expect(t.flights.included).toBe(false);
    expect(t.flights.total).toBe(0);
    const business = planTransport(bali, profile({ flightClass: "business" }));
    expect(business.flights.perAdult).toBe(Math.round(bali.flightEconomyPerPerson * 3.2));
  });
});

describe("itinerary generation", () => {
  it("creates one day per trip day with arrival and departure transfers", () => {
    const it = build(profile());
    expect(it.days).toHaveLength(5);
    expect(it.days[0].items[0].kind).toBe("transfer");
    expect(it.days[4].items.at(-1)!.kind).toBe("transfer");
  });

  it("filters unsuitable activities for young children and accessibility needs", () => {
    const kids = build(profile({ children: 1, childrenAges: [4], tripType: "family" }));
    const refs = kids.days.flatMap((d) => d.items.map((i) => i.catalogRef)).filter(Boolean);
    for (const r of refs) {
      const a = bali.activities.find((x) => x.id === r)!;
      expect(a.kidFriendly).toBe(true);
      expect(a.intensity).not.toBe("active");
    }
  });

  it("produces the same input hash for unchanged preferences", () => {
    expect(itineraryInputHash(profile({ interests: ["food", "beaches"] }))).toBe(itineraryInputHash(profile({ interests: ["beaches", "food"] })));
    expect(itineraryInputHash(profile())).not.toBe(itineraryInputHash(profile({ durationDays: 6 })));
  });
});

describe("itinerary editing", () => {
  const p = profile({ interests: ["culture"] });
  const base = build(p);
  const firstActivity = base.days.flatMap((d) => d.items).find((i) => i.kind === "activity")!;

  it("removes an activity and recomputes the budget", () => {
    const { itinerary } = applyEdit(base, { op: "remove", itemId: firstActivity.id }, bali, p);
    expect(itinerary.days.flatMap((d) => d.items).some((i) => i.id === firstActivity.id)).toBe(false);
    expect(itinerary.budget.activities).toBe(base.budget.activities - firstActivity.estCost);
  });

  it("refuses to remove airport transfers", () => {
    expect(() => applyEdit(base, { op: "remove", itemId: base.days[0].items[0].id }, bali, p)).toThrow(EditError);
  });

  it("replaces with an unused, suitable alternative", () => {
    const { itinerary, affectedDays } = applyEdit(base, { op: "replace", itemId: firstActivity.id }, bali, p);
    const refs = itinerary.days.flatMap((d) => d.items.map((i) => i.catalogRef)).filter(Boolean);
    expect(refs).not.toContain(firstActivity.catalogRef);
    expect(new Set(refs).size).toBe(refs.length);
    expect(affectedDays).toHaveLength(1);
  });

  it("rejects adding an activity that is already planned", () => {
    expect(() => applyEdit(base, { op: "add", dayNumber: 2, catalogRef: firstActivity.catalogRef! }, bali, p)).toThrow(/already/);
  });

  it("reorders within a day and moves between days", () => {
    const day = base.days.find((d) => d.items.length >= 2)!;
    const moved = applyEdit(base, { op: "move", itemId: day.items[1].id, direction: "up" }, bali, p).itinerary;
    expect(moved.days.find((d) => d.id === day.id)!.items[0].id).toBe(day.items[1].id);
    const target = base.days.find((d) => !d.items.some((i) => i.id === firstActivity.id))!;
    const across = applyEdit(base, { op: "moveToDay", itemId: firstActivity.id, dayNumber: target.dayNumber }, bali, p).itinerary;
    expect(across.days.find((d) => d.dayNumber === target.dayNumber)!.items.some((i) => i.id === firstActivity.id)).toBe(true);
  });

  it("regenerates only the requested day", () => {
    const { itinerary } = applyEdit(base, { op: "regenerateDay", dayNumber: 3 }, bali, p);
    for (const n of [1, 2, 4, 5]) expect(itinerary.days[n - 1]).toEqual(base.days[n - 1]);
    const refs = itinerary.days.flatMap((d) => d.items.map((i) => i.catalogRef)).filter(Boolean);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("changes hotel tier and total", () => {
    const { itinerary } = applyEdit(base, { op: "setHotelTier", tier: "luxury" }, bali, p);
    expect(itinerary.hotel.tier).toBe("luxury");
    expect(itinerary.budget.accommodation).toBeGreaterThan(base.budget.accommodation);
  });

  it("does not mutate the original itinerary", () => {
    const snapshot = JSON.stringify(base);
    applyEdit(base, { op: "remove", itemId: firstActivity.id }, bali, p);
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(alternativesFor(base, bali, p).every((a) => !base.days.some((d) => d.items.some((i) => i.catalogRef === a.id)))).toBe(true);
  });
});

it("recomputes budget totals from items", () => {
  const p = profile();
  const it = build(p);
  const b = computeBudget(bali, p, it.days, it.hotel, it.transport);
  expect(b.total).toBe(it.budget.total);
});
