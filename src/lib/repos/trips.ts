import "server-only";
import { all, get, newId, nowIso, parseJson, run, tx } from "@/lib/db";
import type { ActorIdentity } from "@/lib/auth/permissions";
import { getDestination } from "@/lib/catalog/destinations";
import type { PlannerState, QuestionKey } from "@/lib/planner/engine";
import { ProvenanceSchema, type Provenance,
  FieldStatusSchema,
  TripProfileSchema,
  emptyProfile,
  formatMonth,
  totalTravellers,
  type FieldStatus,
  type TripProfile,
} from "@/lib/planner/profile";

export const TRIP_STATUSES = ["planning", "itinerary_ready", "saved", "handoff_requested", "booked", "completed", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export interface TripRow {
  id: string;
  user_id: string | null;
  anon_id: string | null;
  title: string;
  title_is_custom: number;
  status: TripStatus;
  destination_id: string | null;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
  travel_month: string | null;
  duration_days: number | null;
  travellers: number | null;
  estimated_total: number | null;
  currency: string;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export function getTripRow(id: string): TripRow | undefined {
  return get<TripRow>("SELECT * FROM trips WHERE id = ?", [id]);
}

export function defaultTitle(p: TripProfile): string {
  const dest = p.destinationName ?? (p.destinationOpen ? "Destination ideas" : "New trip");
  const when = p.startDate ? formatMonth(p.startDate.slice(0, 7)) : p.travelMonth ? formatMonth(p.travelMonth) : null;
  return when ? `${dest} · ${when}` : dest;
}

export function createTrip(owner: ActorIdentity, opts: { title?: string; profile?: TripProfile; status?: FieldStatus } = {}): TripRow {
  const id = newId("trip");
  const now = nowIso();
  const profile = opts.profile ?? emptyProfile();
  tx(() => {
    run(
      `INSERT INTO trips (id, user_id, anon_id, title, status, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'planning', 'INR', ?, ?)`,
      [id, owner.userId, owner.anonId, opts.title ?? defaultTitle(profile), now, now],
    );
    if (opts.title) run("UPDATE trips SET title_is_custom = 1 WHERE id = ?", [id]);
    run(
      `INSERT INTO trip_preferences (id, trip_id, profile_json, field_status_json, last_question, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'destination', 1, ?, ?)`,
      [newId("pref"), id, JSON.stringify(profile), JSON.stringify(opts.status ?? {}), now, now],
    );
    syncTripFromProfile(id, profile);
  });
  return getTripRow(id)!;
}

export interface PreferencesRecord {
  id: string;
  tripId: string;
  profile: TripProfile;
  status: FieldStatus;
  provenance: Provenance;
  lastQuestion: QuestionKey | null;
  version: number;
  updatedAt: string;
}

export function getPreferences(tripId: string): PreferencesRecord | undefined {
  const row = get<{ id: string; trip_id: string; profile_json: string; field_status_json: string; provenance_json: string; last_question: string | null; version: number; updated_at: string }>(
    "SELECT id, trip_id, profile_json, field_status_json, provenance_json, last_question, version, updated_at FROM trip_preferences WHERE trip_id = ?",
    [tripId],
  );
  if (!row) return undefined;
  const profile = TripProfileSchema.safeParse(parseJson(row.profile_json, {}));
  const status = FieldStatusSchema.safeParse(parseJson(row.field_status_json, {}));
  const provenance = ProvenanceSchema.safeParse(parseJson(row.provenance_json, {}));
  return {
    id: row.id,
    tripId: row.trip_id,
    profile: profile.success ? profile.data : emptyProfile(),
    status: (status.success ? status.data : {}) as FieldStatus,
    provenance: (provenance.success ? provenance.data : {}) as Provenance,
    lastQuestion: (row.last_question as QuestionKey | null) ?? null,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export function getPreferencesById(id: string): PreferencesRecord | undefined {
  const row = get<{ trip_id: string }>("SELECT trip_id FROM trip_preferences WHERE id = ?", [id]);
  return row ? getPreferences(row.trip_id) : undefined;
}

/**
 * Saves the planner state. `expectedVersion` gives optimistic concurrency so
 * overlapping voice and text turns can't silently overwrite each other.
 */
export function savePlannerState(tripId: string, state: PlannerState, expectedVersion?: number): PreferencesRecord {
  const profile = TripProfileSchema.parse(state.profile);
  const now = nowIso();
  return tx(() => {
    const result = run(
      `UPDATE trip_preferences SET profile_json = ?, field_status_json = ?, provenance_json = COALESCE(?, provenance_json), last_question = ?, version = version + 1, updated_at = ?
       WHERE trip_id = ? ${expectedVersion !== undefined ? "AND version = ?" : ""}`,
      [
        JSON.stringify(profile),
        JSON.stringify(state.status),
        state.provenance ? JSON.stringify(state.provenance) : null,
        state.lastQuestion,
        now,
        tripId,
        ...(expectedVersion !== undefined ? [expectedVersion] : []),
      ],
    );
    if (result.changes === 0) throw new VersionConflictError();
    syncTripFromProfile(tripId, profile);
    return getPreferences(tripId)!;
  });
}

export class VersionConflictError extends Error {
  constructor() {
    super("The trip preferences were changed by another request. Please retry.");
  }
}

/** Denormalises key profile fields onto the trip row for listing and analytics. */
function syncTripFromProfile(tripId: string, p: TripProfile) {
  const d = getDestination(p.destinationId);
  run(
    `UPDATE trips SET destination_id = ?, destination_name = ?, start_date = ?, end_date = ?, travel_month = ?,
       duration_days = ?, travellers = ?, title = CASE WHEN title_is_custom = 0 THEN ? ELSE title END, updated_at = ? WHERE id = ?`,
    [
      d?.id ?? null,
      d?.name ?? null,
      p.startDate,
      p.endDate,
      p.travelMonth,
      p.durationDays,
      p.adults !== null ? totalTravellers(p) : null,
      defaultTitle(p),
      nowIso(),
      tripId,
    ],
  );
}

export function updateTrip(id: string, patch: { title?: string; status?: TripStatus; estimatedTotal?: number | null }) {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?", "title_is_custom = 1");
    params.push(patch.title);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.estimatedTotal !== undefined) {
    sets.push("estimated_total = ?");
    params.push(patch.estimatedTotal);
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  params.push(nowIso(), id);
  run(`UPDATE trips SET ${sets.join(", ")} WHERE id = ?`, params);
}

export interface TripListItem extends TripRow {
  itinerary_id: string | null;
  handoff_status: string | null;
  provider_status: string | null;
  customer_name: string | null;
  customer_email: string | null;
  budget_status: string | null;
  lead_name: string | null;
}

const LIST_SELECT = `
  SELECT t.*,
    (SELECT i.id FROM itineraries i WHERE i.trip_id = t.id ORDER BY i.version DESC LIMIT 1) AS itinerary_id,
    (SELECT h.ops_status FROM booking_handoffs h WHERE h.trip_id = t.id ORDER BY h.created_at DESC LIMIT 1) AS handoff_status,
    (SELECT h.provider_status FROM booking_handoffs h WHERE h.trip_id = t.id ORDER BY h.created_at DESC LIMIT 1) AS provider_status,
    (SELECT json_extract(i.budget_json, '$.comparison.status') FROM itineraries i WHERE i.trip_id = t.id ORDER BY i.version DESC LIMIT 1) AS budget_status,
    (SELECT l.name FROM leads l WHERE l.trip_id = t.id ORDER BY l.created_at DESC LIMIT 1) AS lead_name,
    u.name AS customer_name, u.email AS customer_email
  FROM trips t LEFT JOIN users u ON u.id = t.user_id`;

export function listTripsForOwner(owner: ActorIdentity): TripListItem[] {
  if (owner.userId) {
    return all<TripListItem>(`${LIST_SELECT} WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 100`, [owner.userId]);
  }
  return all<TripListItem>(`${LIST_SELECT} WHERE t.user_id IS NULL AND t.anon_id = ? ORDER BY t.updated_at DESC LIMIT 100`, [owner.anonId]);
}

export function listAllTrips(filter: { status?: string; q?: string; flag?: string; limit: number; offset: number }): { items: TripListItem[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.flag === "over_budget") {
    where.push("EXISTS (SELECT 1 FROM itineraries i WHERE i.trip_id = t.id AND i.version = (SELECT MAX(version) FROM itineraries WHERE trip_id = t.id) AND json_extract(i.budget_json, '$.comparison.status') = 'over')");
  } else if (filter.flag === "awaiting_review") {
    where.push("t.status = 'itinerary_ready'");
  } else if (filter.flag === "no_itinerary") {
    where.push("t.status = 'planning'");
  }
  if (filter.status) {
    where.push("t.status = ?");
    params.push(filter.status);
  }
  if (filter.q) {
    where.push("(t.title LIKE ? OR t.destination_name LIKE ? OR u.name LIKE ? OR u.email LIKE ?)");
    const like = `%${filter.q}%`;
    params.push(like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = get<{ c: number }>(`SELECT COUNT(*) c FROM trips t LEFT JOIN users u ON u.id = t.user_id ${whereSql}`, params)?.c ?? 0;
  const items = all<TripListItem>(`${LIST_SELECT} ${whereSql} ORDER BY t.updated_at DESC LIMIT ? OFFSET ?`, [...params, filter.limit, filter.offset]);
  return { items, total };
}

export function duplicateTrip(owner: ActorIdentity, sourceId: string): TripRow {
  const prefs = getPreferences(sourceId);
  const source = getTripRow(sourceId);
  return createTrip(owner, {
    title: source ? `${source.title} (copy)` : undefined,
    profile: prefs?.profile ?? emptyProfile(),
    status: prefs?.status ?? {},
  });
}
