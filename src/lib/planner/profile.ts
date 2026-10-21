import { z } from "zod";
import { INTERESTS } from "@/lib/catalog/types";

/**
 * The structured trip profile is the single source of truth for a customer's
 * preferences. It is shared by text chat, voice, the itinerary generator and
 * the CRM, and is persisted in `trip_preferences.profile_json`.
 */

export const CURRENCIES = ["INR", "USD", "EUR", "AED", "GBP", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Fixed, approximate demo exchange rates to INR (not live rates). */
export const DEMO_FX_TO_INR: Record<Currency, number> = {
  INR: 1,
  USD: 84,
  EUR: 91,
  AED: 23,
  GBP: 107,
  SGD: 63,
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const TripProfileSchema = z.object({
  destinationId: z.string().max(40).nullable(),
  destinationName: z.string().max(80).nullable(),
  /** Customer wants destination recommendations instead of naming one. */
  destinationOpen: z.boolean(),
  departureCity: z.string().max(60).nullable(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  travelMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  dateFlexibility: z.enum(["fixed", "few_days", "flexible"]).nullable(),
  durationDays: z.number().int().min(1).max(60).nullable(),
  adults: z.number().int().min(1).max(30).nullable(),
  children: z.number().int().min(0).max(20).nullable(),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(20),
  tripType: z.enum(["family", "couple", "honeymoon", "friends", "solo", "business", "group"]).nullable(),
  occasion: z.string().max(80).nullable(),
  interests: z.array(z.enum(INTERESTS)).max(12),
  pace: z.enum(["relaxed", "balanced", "packed"]).nullable(),
  budgetAmount: z.number().int().min(1).max(1_000_000_000).nullable(),
  currency: z.enum(CURRENCIES),
  budgetScope: z.enum(["total", "per_person"]).nullable(),
  budgetIncludesFlights: z.boolean().nullable(),
  accommodation: z.enum(["budget", "midrange", "luxury"]).nullable(),
  needsFlights: z.boolean().nullable(),
  flightClass: z.enum(["economy", "premium_economy", "business"]).nullable(),
  dietary: z.array(z.string().max(40)).max(10),
  accessibility: z.string().max(200).nullable(),
  mustSee: z.array(z.string().max(80)).max(10),
  specialRequests: z.string().max(300).nullable(),
});
export type TripProfile = z.infer<typeof TripProfileSchema>;

export function emptyProfile(): TripProfile {
  return {
    destinationId: null,
    destinationName: null,
    destinationOpen: false,
    departureCity: null,
    startDate: null,
    endDate: null,
    travelMonth: null,
    dateFlexibility: null,
    durationDays: null,
    adults: null,
    children: null,
    childrenAges: [],
    tripType: null,
    occasion: null,
    interests: [],
    pace: null,
    budgetAmount: null,
    currency: "INR",
    budgetScope: null,
    budgetIncludesFlights: null,
    accommodation: null,
    needsFlights: null,
    flightClass: null,
    dietary: [],
    accessibility: null,
    mustSee: [],
    specialRequests: null,
  };
}

/** The 15 discovery topics, in default asking order. */
export const FIELD_KEYS = [
  "destination",
  "duration",
  "dates",
  "travellers",
  "childrenAges",
  "budget",
  "budgetIncludesFlights",
  "departureCity",
  "tripType",
  "interests",
  "pace",
  "accommodation",
  "transport",
  "requirements",
  "mustSee",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export const FIELD_LABELS: Record<FieldKey, string> = {
  destination: "Destination",
  duration: "Duration",
  dates: "Dates",
  travellers: "Travellers",
  childrenAges: "Children's ages",
  departureCity: "Departing from",
  budget: "Budget",
  budgetIncludesFlights: "Budget covers flights",
  tripType: "Trip type",
  interests: "Interests",
  pace: "Pace",
  accommodation: "Stay",
  transport: "Flights",
  requirements: "Requirements",
  mustSee: "Must-sees",
};

/** Essentials needed before an itinerary can be generated. */
export const ESSENTIAL_FIELDS: FieldKey[] = ["destination", "duration", "dates", "travellers", "budget"];

/** 'unknown' = "I don't know yet", 'skipped' = skipped optional, 'none' = "no requirements". */
export const FieldStatusSchema = z.record(z.string(), z.enum(["unknown", "skipped", "none"]));
export type FieldStatusValue = "unknown" | "skipped" | "none";
export type FieldStatus = Partial<Record<FieldKey, FieldStatusValue>>;

/**
 * Where a preference came from. Only "stated" and "confirmed" are verified by
 * the customer; "inferred" (planner deduction) and "default" (application
 * assumption) are shown as such and confirmed in the summary step.
 */
export const PROVENANCE_VALUES = ["stated", "inferred", "default", "confirmed"] as const;
export type ProvenanceValue = (typeof PROVENANCE_VALUES)[number];
export type Provenance = Partial<Record<FieldKey, ProvenanceValue>>;
export const ProvenanceSchema = z.record(z.string(), z.enum(PROVENANCE_VALUES));

export function isAnswered(field: FieldKey, p: TripProfile): boolean {
  switch (field) {
    case "destination":
      return !!p.destinationId;
    case "duration":
      return p.durationDays !== null;
    case "dates":
      return (!!p.startDate && !!p.endDate) || (!!p.travelMonth && p.dateFlexibility !== null);
    case "travellers":
      return p.adults !== null && p.children !== null;
    case "childrenAges":
      return (p.children ?? 0) === 0 || p.childrenAges.length > 0;
    case "departureCity":
      return !!p.departureCity;
    case "budget":
      return p.budgetAmount !== null;
    case "budgetIncludesFlights":
      return p.budgetIncludesFlights !== null;
    case "tripType":
      return p.tripType !== null || !!p.occasion;
    case "interests":
      return p.interests.length > 0;
    case "pace":
      return p.pace !== null;
    case "accommodation":
      return p.accommodation !== null;
    case "transport":
      return p.needsFlights === false || p.flightClass !== null;
    case "requirements":
      return p.dietary.length > 0 || !!p.accessibility;
    case "mustSee":
      return p.mustSee.length > 0 || !!p.specialRequests;
  }
}

/** Whether a topic is worth asking about given what we already know. */
export function isRelevant(field: FieldKey, p: TripProfile): boolean {
  switch (field) {
    case "childrenAges":
      return (p.children ?? 0) > 0;
    case "departureCity":
      return p.needsFlights !== false;
    case "budgetIncludesFlights":
      return p.budgetAmount !== null && p.needsFlights !== false;
    default:
      return true;
  }
}

export function isResolved(field: FieldKey, p: TripProfile, status: FieldStatus): boolean {
  return !isRelevant(field, p) || isAnswered(field, p) || status[field] !== undefined;
}

export function essentialsResolved(p: TripProfile, status: FieldStatus): boolean {
  return ESSENTIAL_FIELDS.every((f) => isResolved(f, p, status));
}

export function completion(p: TripProfile, status: FieldStatus): { resolved: number; total: number } {
  const relevant = FIELD_KEYS.filter((f) => isRelevant(f, p));
  return { resolved: relevant.filter((f) => isResolved(f, p, status)).length, total: relevant.length };
}

export function totalTravellers(p: TripProfile): number {
  return (p.adults ?? 2) + (p.children ?? 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatMoney(amount: number, currency: string = "INR"): string {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-IN")}`;
  }
}

/** Human-readable value for a topic, used by the progress panel and summaries. */
export function describeField(field: FieldKey, p: TripProfile, status: FieldStatus): string | null {
  if (!isAnswered(field, p)) {
    const s = status[field];
    if (s === "unknown") return "Not decided yet";
    if (s === "skipped") return "Skipped";
    if (s === "none") return "None";
    if (field === "destination" && p.destinationOpen) return "Open to suggestions";
    if (field === "dates" && p.travelMonth) return formatMonth(p.travelMonth);
    return null;
  }
  switch (field) {
    case "destination":
      return p.destinationName ?? p.destinationId;
    case "duration":
      return `${p.durationDays} day${p.durationDays === 1 ? "" : "s"}`;
    case "dates": {
      const flex =
        p.dateFlexibility === "flexible" ? " (flexible)" : p.dateFlexibility === "few_days" ? " (± a few days)" : "";
      if (p.startDate && p.endDate) return `${formatDate(p.startDate)} – ${formatDate(p.endDate)}${flex}`;
      return `${formatMonth(p.travelMonth!)}${flex}`;
    }
    case "travellers": {
      const a = `${p.adults} adult${p.adults === 1 ? "" : "s"}`;
      return p.children ? `${a}, ${p.children} child${p.children === 1 ? "" : "ren"}` : a;
    }
    case "childrenAges":
      return p.childrenAges.length ? `Ages ${p.childrenAges.join(", ")}` : null;
    case "departureCity":
      return p.departureCity;
    case "budget":
      return `${formatMoney(p.budgetAmount!, p.currency)} ${p.budgetScope === "per_person" ? "per person" : "total"}`;
    case "budgetIncludesFlights":
      return p.budgetIncludesFlights ? "Includes flights" : "Excludes flights";
    case "tripType":
      return [p.tripType, p.occasion].filter(Boolean).join(" · ");
    case "interests":
      return p.interests.map((i) => i.replace("_", " ")).join(", ");
    case "pace":
      return p.pace;
    case "accommodation":
      return { budget: "Budget / 3★", midrange: "Comfort / 4★", luxury: "Luxury / 5★" }[p.accommodation!];
    case "transport":
      return p.needsFlights === false ? "Booking own flights" : (p.flightClass ?? "").replace("_", " ");
    case "requirements":
      return [...p.dietary, p.accessibility].filter(Boolean).join(", ");
    case "mustSee":
      return [...p.mustSee, p.specialRequests].filter(Boolean).join(", ");
  }
}
