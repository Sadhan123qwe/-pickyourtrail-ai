import { createHash } from "node:crypto";
import type { CatalogActivity, Destination, HotelTier } from "@/lib/catalog/types";
import { INTEREST_LABELS } from "@/lib/catalog/types";
import { addDays } from "@/lib/planner/rules-extractor";
import type { TripProfile } from "@/lib/planner/profile";
import { activityGroupCost, budgetInInr, computeBudget, party, planTransport, selectHotel, tripDays } from "./budget";
import type { Itinerary, ItineraryDay, ItineraryItem } from "./types";

/**
 * Itinerary construction. A "day plan" (which catalog activities go on which
 * day, plus reasons) comes either from the deterministic planner below or from
 * the LLM. Either way, `buildItinerary` validates it against the catalog and
 * computes every cost in code, so the AI can never invent prices.
 */

export interface DayPlan {
  title?: string | null;
  activityIds: string[];
  reasons?: Record<string, string>;
}

export function uid(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Hash of the inputs that affect generation; unchanged inputs reuse the saved itinerary. */
export function itineraryInputHash(p: TripProfile): string {
  const relevant = {
    d: p.destinationId,
    n: p.durationDays,
    s: p.startDate,
    a: p.adults,
    c: p.children,
    ages: p.childrenAges,
    t: p.tripType,
    i: [...p.interests].sort(),
    pace: p.pace,
    b: p.budgetAmount,
    cur: p.currency,
    sc: p.budgetScope,
    bf: p.budgetIncludesFlights,
    acc: p.accommodation,
    f: p.needsFlights,
    fc: p.flightClass,
    from: p.departureCity,
    req: [p.dietary, p.accessibility],
    must: p.mustSee,
  };
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex").slice(0, 32);
}

const PACE = {
  relaxed: { maxActivities: 2, maxHours: 6 },
  balanced: { maxActivities: 2, maxHours: 8 },
  packed: { maxActivities: 3, maxHours: 11 },
} as const;

/** Hard filters: activities that are unsuitable for this party. */
export function isSuitable(a: CatalogActivity, p: TripProfile): boolean {
  if ((p.children ?? 0) > 0 && !a.kidFriendly) return false;
  if (p.childrenAges.some((age) => age < 6) && a.intensity === "active") return false;
  if (p.accessibility && a.intensity === "active") return false;
  return true;
}

export function scoreActivity(a: CatalogActivity, p: TripProfile, d: Destination): number {
  let score = 1;
  score += a.tags.filter((t) => p.interests.includes(t)).length * 3;
  if (p.mustSee.some((m) => matchesMustSee(a, m))) score += 6;
  if (p.pace === "relaxed" && a.intensity === "active") score -= 2;
  if (p.pace === "packed" && a.intensity === "active") score += 1;
  if ((p.tripType === "honeymoon" || p.tripType === "couple") && a.tags.includes("romance")) score += 2;
  if ((p.children ?? 0) > 0 && a.tags.includes("family_fun")) score += 2;
  if (p.tripType === "friends" && (a.tags.includes("nightlife") || a.tags.includes("adventure"))) score += 1;
  // Prefer cheaper options when the budget is tight.
  const budget = budgetInInr(p, party(p).total);
  if (budget !== null) {
    const perPersonPerDay = budget / party(p).total / tripDays(p, d);
    if (perPersonPerDay < 15_000) score -= a.costPerPerson / 4000;
  }
  return score;
}

function matchesMustSee(a: CatalogActivity, mustSee: string): boolean {
  const words = mustSee.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const title = `${a.title} ${a.area}`.toLowerCase();
  return words.some((w) => title.includes(w));
}

export function explainActivity(a: CatalogActivity, p: TripProfile, dayArea: string | null): string {
  const reasons: string[] = [];
  const matched = a.tags.filter((t) => p.interests.includes(t));
  if (p.mustSee.some((m) => matchesMustSee(a, m))) reasons.push("You asked to see this");
  if (matched.length) reasons.push(`Matches your interest in ${matched.map((t) => INTEREST_LABELS[t].toLowerCase()).join(" and ")}`);
  if ((p.children ?? 0) > 0 && a.kidFriendly) reasons.push("Kid-friendly");
  if ((p.tripType === "honeymoon" || p.tripType === "couple") && a.tags.includes("romance")) reasons.push("Great for couples");
  if (p.pace === "relaxed" && a.intensity === "easy") reasons.push("Easy-going, fits a relaxed pace");
  if (dayArea && a.area === dayArea) reasons.push(`Close to the day's other stops in ${dayArea}`);
  if (a.costPerPerson === 0) reasons.push("Free to visit");
  if (!reasons.length) reasons.push(`A highlight of ${a.area}`);
  return reasons.slice(0, 3).join(" · ");
}

type Scored = { a: CatalogActivity; score: number };

function rankCandidates(d: Destination, p: TripProfile, exclude: Set<string>): Scored[] {
  return d.activities
    .filter((a) => isSuitable(a, p) && !exclude.has(a.id))
    .map((a) => ({ a, score: scoreActivity(a, p, d) }))
    .sort((x, y) => y.score - x.score || x.a.costPerPerson - y.a.costPerPerson);
}

/** Picks activities for one day: anchor by score, then same-area fillers within the pace limits. */
function planOneDay(day: number, totalDays: number, candidates: Scored[], used: Set<string>, p: TripProfile): DayPlan {
  const pace = PACE[p.pace ?? "balanced"];
  const isArrival = day === 1 && totalDays > 1;
  const isDeparture = day === totalDays && totalDays > 2;
  const maxHours = isArrival || isDeparture ? 3.5 : pace.maxHours;
  const maxActs = isArrival || isDeparture ? 1 : pace.maxActivities;
  const chosen: CatalogActivity[] = [];
  let hours = 0;
  const remaining = candidates.filter((c) => !used.has(c.a.id));
  const anchor = remaining.find((c) => c.a.hours <= maxHours);
  if (anchor) {
    chosen.push(anchor.a);
    hours += anchor.a.hours;
    used.add(anchor.a.id);
    // Full-day trips stand alone unless the pace is packed.
    const fullDay = anchor.a.hours >= 7;
    const slots = fullDay ? (p.pace === "packed" ? 1 : 0) : maxActs - 1;
    const pool = remaining
      .filter((c) => !used.has(c.a.id))
      .sort((x, y) => Number(y.a.area === anchor.a.area) - Number(x.a.area === anchor.a.area) || y.score - x.score);
    for (const c of pool) {
      if (chosen.length - 1 >= slots) break;
      if (hours + c.a.hours > maxHours) continue;
      if (fullDay && c.a.hours > 3) continue;
      chosen.push(c.a);
      hours += c.a.hours;
      used.add(c.a.id);
    }
  }
  return {
    activityIds: chosen.map((a) => a.id),
    reasons: Object.fromEntries(chosen.map((a) => [a.id, explainActivity(a, p, chosen[0]?.area ?? null)])),
  };
}

/** Deterministic day planner: greedy fill by score, grouped by area, paced. */
export function planDaysDeterministic(d: Destination, p: TripProfile, exclude: Set<string> = new Set()): DayPlan[] {
  const days = tripDays(p, d);
  const candidates = rankCandidates(d, p, exclude);
  const used = new Set<string>();
  return Array.from({ length: days }, (_, i) => planOneDay(i + 1, days, candidates, used, p));
}

/** Re-plans a single day from activities not in `exclude` (used for "regenerate this day"). */
export function planSingleDay(d: Destination, p: TripProfile, dayNumber: number, exclude: Set<string>): DayPlan {
  return planOneDay(dayNumber, tripDays(p, d), rankCandidates(d, p, exclude), new Set(), p);
}

/** Builds day objects (with transfer/free-time items) from validated plans. */
export function buildDays(d: Destination, p: TripProfile, plans: DayPlan[]): ItineraryDay[] {
  const days = tripDays(p, d);
  const pc = party(p);
  const byId = new Map(d.activities.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const result: ItineraryDay[] = [];
  for (let n = 1; n <= days; n++) {
    const plan = plans[n - 1] ?? { activityIds: [] };
    const acts = plan.activityIds
      .map((id) => byId.get(id))
      .filter((a): a is CatalogActivity => !!a && !seen.has(a.id) && isSuitable(a, p));
    acts.forEach((a) => seen.add(a.id));
    const area = acts[0]?.area ?? null;
    const items: ItineraryItem[] = [];
    if (n === 1) {
      items.push({
        id: uid("itm"), kind: "transfer", catalogRef: null, title: `Arrive at ${d.arrivalAirport} & transfer to hotel`,
        description: "Private airport transfer and hotel check-in.", area: null, durationHours: 1.5, estCost: 0,
        reason: "Included in local transport estimate",
      });
    }
    for (const a of acts) {
      items.push({
        id: uid("itm"), kind: "activity", catalogRef: a.id, title: a.title, description: a.description, area: a.area,
        durationHours: a.hours, estCost: activityGroupCost(a, pc),
        reason: plan.reasons?.[a.id]?.slice(0, 240) || explainActivity(a, p, area),
      });
    }
    const activityHours = acts.reduce((s, a) => s + a.hours, 0);
    if (activityHours < 3 && !(n === days && days > 1)) {
      items.push({
        id: uid("itm"), kind: "free_time", catalogRef: null, title: "Free time at leisure",
        description: "Relax at the hotel, explore nearby cafés or shop at your own pace.", area: null,
        durationHours: null, estCost: 0, reason: p.pace === "relaxed" ? "Keeps the day relaxed, as you asked" : "Breathing room after travel",
      });
    }
    if (n === days && days > 1) {
      items.push({
        id: uid("itm"), kind: "transfer", catalogRef: null, title: "Check out & transfer to the airport",
        description: "Private transfer for your flight home.", area: null, durationHours: 1.5, estCost: 0,
        reason: "Included in local transport estimate",
      });
    }
    result.push({
      id: uid("day"),
      dayNumber: n,
      title: dayTitle(n, days, acts, plan.title),
      area,
      date: p.startDate ? addDays(p.startDate, n - 1) : null,
      items,
    });
  }
  return result;
}

export function dayTitle(n: number, total: number, acts: CatalogActivity[], suggested?: string | null): string {
  if (suggested && suggested.length <= 80) return suggested;
  if (!acts.length) return n === 1 ? "Arrival & settle in" : n === total ? "Departure day" : "Day at leisure";
  const names = acts.slice(0, 2).map((a) => a.title.split(/ & | – |, /)[0]);
  const prefix = n === 1 ? "Arrival · " : n === total && total > 1 ? "Last day · " : "";
  return `${prefix}${names.join(" & ")}`;
}

export function defaultHotelTier(p: TripProfile, d: Destination): HotelTier {
  if (p.accommodation) return p.accommodation;
  const budget = budgetInInr(p, party(p).total);
  if (budget === null) return "midrange";
  const perPersonPerNight = budget / party(p).total / Math.max(tripDays(p, d) - 1, 1);
  return perPersonPerNight < 6000 ? "budget" : perPersonPerNight > 30000 ? "luxury" : "midrange";
}

export function summarize(d: Destination, p: TripProfile, days: number): string {
  const pace = p.pace ?? "balanced";
  const who =
    p.tripType === "family" ? "family" : p.tripType === "honeymoon" ? "honeymoon" : p.tripType === "friends" ? "friends'" : p.tripType === "solo" ? "solo" : p.tripType === "couple" ? "couple's" : "";
  const focus = p.interests.length ? ` focused on ${p.interests.slice(0, 3).map((i) => INTEREST_LABELS[i].toLowerCase()).join(", ")}` : "";
  const extra = p.dietary.length ? ` Restaurants and activities noted for ${p.dietary.join(", ")} preferences.` : "";
  return `A ${pace} ${days}-day ${who ? `${who} ` : ""}trip to ${d.name}${focus}.${extra}`;
}

export function buildItinerary(args: {
  id?: string;
  tripId: string;
  version: number;
  destination: Destination;
  profile: TripProfile;
  plans: DayPlan[];
  generatedBy: string;
  summary?: string | null;
  now?: string;
}): Itinerary {
  const { destination: d, profile: p } = args;
  const days = buildDays(d, p, args.plans);
  const hotel = selectHotel(d, defaultHotelTier(p, d), p);
  const transport = planTransport(d, p);
  const now = args.now ?? new Date().toISOString();
  return {
    id: args.id ?? uid("itn"),
    tripId: args.tripId,
    version: args.version,
    inputHash: itineraryInputHash(p),
    generatedBy: args.generatedBy,
    summary: args.summary?.slice(0, 400) || summarize(d, p, days.length),
    destinationId: d.id,
    days,
    hotel,
    transport,
    budget: computeBudget(d, p, days, hotel, transport),
    createdAt: now,
    updatedAt: now,
  };
}
