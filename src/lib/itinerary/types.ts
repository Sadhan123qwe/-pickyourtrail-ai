import type { HotelTier } from "@/lib/catalog/types";

export interface ItineraryItem {
  id: string;
  kind: "activity" | "transfer" | "free_time";
  catalogRef: string | null;
  title: string;
  description: string;
  area: string | null;
  durationHours: number | null;
  /** Estimated cost for the whole group in INR. */
  estCost: number;
  reason: string | null;
}

export interface ItineraryDay {
  id: string;
  dayNumber: number;
  title: string;
  area: string | null;
  date: string | null;
  items: ItineraryItem[];
}

export interface HotelSelection {
  tier: HotelTier;
  name: string;
  area: string;
  highlights: string;
  nightlyRate: number;
  rooms: number;
  nights: number;
  total: number;
  alternatives: { tier: HotelTier; name: string; nightlyRate: number }[];
}

export interface TransportPlan {
  flights: {
    included: boolean;
    cabin: "economy" | "premium_economy" | "business";
    from: string | null;
    to: string;
    perAdult: number;
    total: number;
    note: string;
  };
  local: { perDay: number; vehicles: number; days: number; total: number; note: string };
}

export interface BudgetComparison {
  status: "under" | "near" | "over" | "unknown";
  budgetInr: number | null;
  comparableTotal: number;
  difference: number | null;
  note: string;
}

export interface BudgetBreakdown {
  currency: "INR";
  flights: number;
  accommodation: number;
  activities: number;
  localTransport: number;
  meals: number;
  total: number;
  perPerson: number;
  travellers: number;
  comparison: BudgetComparison;
  assumptions: string[];
}

export interface Itinerary {
  id: string;
  tripId: string;
  version: number;
  inputHash: string;
  generatedBy: string;
  summary: string;
  destinationId: string;
  days: ItineraryDay[];
  hotel: HotelSelection;
  transport: TransportPlan;
  budget: BudgetBreakdown;
  createdAt: string;
  updatedAt: string;
}
