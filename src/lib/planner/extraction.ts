import { z } from "zod";
import { INTERESTS } from "@/lib/catalog/types";
import { CURRENCIES, FIELD_KEYS, type FieldKey, type TripProfile } from "./profile";

/**
 * What an extractor (LLM or rules) returns for one customer message.
 * Only fields the customer actually mentioned appear in `updates`.
 */
export interface ExtractionResult {
  updates: Partial<TripProfile>;
  resolved: { field: FieldKey; status: "unknown" | "skipped" | "none" }[];
  wantsRecommendations: boolean;
  wantsToGenerate: boolean;
  /** A question the customer asked that is not an answer (e.g. "is it rainy?"). */
  sideQuestion: string | null;
  /** Optional short answer to the side question (live AI only). */
  sideAnswer: string | null;
  /** Fields the extractor deduced rather than heard (e.g. "kids" → family trip). */
  inferred?: FieldKey[];
}

export function emptyExtraction(): ExtractionResult {
  return { updates: {}, resolved: [], wantsRecommendations: false, wantsToGenerate: false, sideQuestion: null, sideAnswer: null };
}

/**
 * Strict schema for LLM structured output. Every key is required and `null`
 * means "not mentioned in this message", which keeps the schema compatible
 * with strict JSON-schema mode.
 */
export const LlmExtractionSchema = z.strictObject({
  destination: z.string().nullable().describe("Destination the customer wants, as they named it"),
  wantsRecommendations: z.boolean().describe("True if they are unsure where to go and want suggestions"),
  departureCity: z.string().nullable(),
  startDate: z.string().nullable().describe("YYYY-MM-DD"),
  endDate: z.string().nullable().describe("YYYY-MM-DD"),
  travelMonth: z.string().nullable().describe("YYYY-MM when only a month is known"),
  dateFlexibility: z.enum(["fixed", "few_days", "flexible"]).nullable(),
  durationDays: z.number().int().nullable(),
  adults: z.number().int().nullable(),
  children: z.number().int().nullable(),
  childrenAges: z.array(z.number().int()).nullable(),
  tripType: z.enum(["family", "couple", "honeymoon", "friends", "solo", "business", "group"]).nullable(),
  occasion: z.string().nullable(),
  interests: z.array(z.enum(INTERESTS)).nullable(),
  pace: z.enum(["relaxed", "balanced", "packed"]).nullable(),
  budgetAmount: z.number().nullable().describe("Numeric amount, e.g. 150000 for 1.5 lakh"),
  currency: z.enum(CURRENCIES).nullable(),
  budgetScope: z.enum(["total", "per_person"]).nullable(),
  budgetIncludesFlights: z.boolean().nullable(),
  accommodation: z.enum(["budget", "midrange", "luxury"]).nullable(),
  needsFlights: z.boolean().nullable().describe("False if they will book flights themselves"),
  flightClass: z.enum(["economy", "premium_economy", "business"]).nullable(),
  dietary: z.array(z.string()).nullable(),
  accessibility: z.string().nullable(),
  mustSee: z.array(z.string()).nullable(),
  specialRequests: z.string().nullable(),
  unknownFields: z.array(z.enum(FIELD_KEYS)).describe("Topics the customer explicitly does not know yet"),
  noneFields: z.array(z.enum(FIELD_KEYS)).describe("Topics answered with 'none' / 'nothing specific'"),
  skippedFields: z.array(z.enum(FIELD_KEYS)).describe("Topics the customer asked to skip"),
  wantsToGenerate: z.boolean().describe("True if they ask to create the itinerary now"),
  sideQuestion: z.string().nullable(),
  sideAnswer: z
    .string()
    .nullable()
    .describe("One or two sentence general answer to sideQuestion; never state prices, availability or policies"),
});
export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;

/** Converts an LLM extraction into the common result, dropping nulls. */
export function fromLlmExtraction(x: LlmExtraction): ExtractionResult {
  const updates: Partial<TripProfile> = {};
  const assign = <K extends keyof TripProfile>(key: K, value: TripProfile[K] | null | undefined) => {
    if (value !== null && value !== undefined) updates[key] = value;
  };
  if (x.destination) updates.destinationName = x.destination.slice(0, 80);
  assign("departureCity", x.departureCity?.slice(0, 60));
  assign("startDate", x.startDate && /^\d{4}-\d{2}-\d{2}$/.test(x.startDate) ? x.startDate : null);
  assign("endDate", x.endDate && /^\d{4}-\d{2}-\d{2}$/.test(x.endDate) ? x.endDate : null);
  assign("travelMonth", x.travelMonth && /^\d{4}-\d{2}$/.test(x.travelMonth) ? x.travelMonth : null);
  assign("dateFlexibility", x.dateFlexibility);
  assign("durationDays", x.durationDays && x.durationDays >= 1 && x.durationDays <= 60 ? x.durationDays : null);
  assign("adults", x.adults && x.adults >= 1 && x.adults <= 30 ? x.adults : null);
  assign("children", x.children !== null && x.children >= 0 && x.children <= 20 ? x.children : null);
  assign("childrenAges", x.childrenAges?.filter((a) => a >= 0 && a <= 17).slice(0, 20));
  assign("tripType", x.tripType);
  assign("occasion", x.occasion?.slice(0, 80));
  if (x.interests?.length) updates.interests = x.interests;
  assign("pace", x.pace);
  assign("budgetAmount", x.budgetAmount && x.budgetAmount > 0 ? Math.round(x.budgetAmount) : null);
  assign("currency", x.currency);
  assign("budgetScope", x.budgetScope);
  assign("budgetIncludesFlights", x.budgetIncludesFlights);
  assign("accommodation", x.accommodation);
  assign("needsFlights", x.needsFlights);
  assign("flightClass", x.flightClass);
  if (x.dietary?.length) updates.dietary = x.dietary.map((d) => d.slice(0, 40)).slice(0, 10);
  assign("accessibility", x.accessibility?.slice(0, 200));
  if (x.mustSee?.length) updates.mustSee = x.mustSee.map((m) => m.slice(0, 80)).slice(0, 10);
  assign("specialRequests", x.specialRequests?.slice(0, 300));
  return {
    updates,
    resolved: [
      ...x.unknownFields.map((field) => ({ field, status: "unknown" as const })),
      ...x.noneFields.map((field) => ({ field, status: "none" as const })),
      ...x.skippedFields.map((field) => ({ field, status: "skipped" as const })),
    ],
    wantsRecommendations: x.wantsRecommendations,
    wantsToGenerate: x.wantsToGenerate,
    sideQuestion: x.sideQuestion,
    sideAnswer: x.sideAnswer ? x.sideAnswer.slice(0, 400) : null,
  };
}
