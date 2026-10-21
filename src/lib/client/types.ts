/** Client-side shapes of API responses (mirrors server types without importing server code). */
export type { Itinerary, ItineraryDay, ItineraryItem, BudgetBreakdown, HotelSelection, TransportPlan } from "@/lib/itinerary/types";
import type { Itinerary } from "@/lib/itinerary/types";
import type { FieldStatus, TripProfile } from "@/lib/planner/profile";

export interface TripRow {
  id: string;
  title: string;
  status: string;
  destination_id: string | null;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
  travel_month: string | null;
  duration_days: number | null;
  travellers: number | null;
  estimated_total: number | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Handoff {
  id: string;
  trip_id: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  notes: string | null;
  customer_confirmed_at: string;
  confirmation_text: string;
  provider: string;
  provider_status: string;
  provider_reference: string | null;
  ops_status: string;
  quoted_total: number | null;
  assigned_to: string | null;
  assignee_name?: string | null;
  trip_title?: string;
  destination_name?: string | null;
  start_date?: string | null;
  travellers?: number | null;
  estimated_total?: number | null;
  is_demo?: number;
  created_at: string;
  updated_at: string;
}

export interface TripDetail {
  trip: TripRow;
  profile: TripProfile;
  status: FieldStatus;
  version: number;
  completion: { resolved: number; total: number };
  summary: string;
  itinerary: Itinerary | null;
  handoff: Handoff | null;
  lead?: Record<string, unknown> | null;
  audit?: AuditEvent[];
}

export interface AuditEvent {
  id: string;
  actor_label: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
}
