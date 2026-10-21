import "server-only";
import { all, get, nowIso, parseJson, run, tx } from "@/lib/db";
import type { BudgetBreakdown, HotelSelection, Itinerary, ItineraryDay, ItineraryItem, TransportPlan } from "@/lib/itinerary/types";

interface ItineraryRow {
  id: string;
  trip_id: string;
  version: number;
  destination_id: string;
  input_hash: string;
  generated_by: string;
  summary: string;
  hotel_json: string;
  transport_json: string;
  budget_json: string;
  total_estimate: number;
  created_at: string;
  updated_at: string;
}

function writeDays(itineraryId: string, days: ItineraryDay[]) {
  run("DELETE FROM itinerary_days WHERE itinerary_id = ?", [itineraryId]);
  for (const day of days) {
    run("INSERT INTO itinerary_days (id, itinerary_id, day_number, title, area, date) VALUES (?, ?, ?, ?, ?, ?)", [
      day.id, itineraryId, day.dayNumber, day.title, day.area, day.date,
    ]);
    day.items.forEach((item, position) => {
      run(
        `INSERT INTO itinerary_items (id, day_id, position, kind, catalog_ref, title, description, area, duration_hours, est_cost, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.id, day.id, position, item.kind, item.catalogRef, item.title, item.description, item.area, item.durationHours, item.estCost, item.reason],
      );
    });
  }
}

/** Inserts a new itinerary version for a trip. */
export function insertItinerary(it: Itinerary): Itinerary {
  tx(() => {
    run(
      `INSERT INTO itineraries (id, trip_id, version, destination_id, input_hash, generated_by, summary, hotel_json, transport_json, budget_json,
         total_estimate, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?)`,
      [
        it.id, it.tripId, it.version, it.destinationId, it.inputHash, it.generatedBy, it.summary, JSON.stringify(it.hotel),
        JSON.stringify(it.transport), JSON.stringify(it.budget), it.budget.total, it.createdAt, it.updatedAt,
      ],
    );
    writeDays(it.id, it.days);
  });
  return getItinerary(it.id)!;
}

/** Persists an edited itinerary in place (same version). */
export function saveItinerary(it: Itinerary): Itinerary {
  tx(() => {
    run(
      `UPDATE itineraries SET summary = ?, hotel_json = ?, transport_json = ?, budget_json = ?, total_estimate = ?, updated_at = ? WHERE id = ?`,
      [it.summary, JSON.stringify(it.hotel), JSON.stringify(it.transport), JSON.stringify(it.budget), it.budget.total, nowIso(), it.id],
    );
    writeDays(it.id, it.days);
  });
  return getItinerary(it.id)!;
}

export function getItinerary(id: string): Itinerary | undefined {
  const row = get<ItineraryRow>("SELECT * FROM itineraries WHERE id = ?", [id]);
  if (!row) return undefined;
  const days = all<{ id: string; day_number: number; title: string; area: string | null; date: string | null }>(
    "SELECT id, day_number, title, area, date FROM itinerary_days WHERE itinerary_id = ? ORDER BY day_number",
    [id],
  );
  const items = all<{
    id: string; day_id: string; kind: ItineraryItem["kind"]; catalog_ref: string | null; title: string; description: string | null;
    area: string | null; duration_hours: number | null; est_cost: number; reason: string | null;
  }>(
    `SELECT it.* FROM itinerary_items it JOIN itinerary_days d ON d.id = it.day_id WHERE d.itinerary_id = ? ORDER BY it.position`,
    [id],
  );
  return {
    id: row.id,
    tripId: row.trip_id,
    version: row.version,
    inputHash: row.input_hash,
    generatedBy: row.generated_by,
    summary: row.summary,
    destinationId: row.destination_id,
    days: days.map((d) => ({
      id: d.id,
      dayNumber: d.day_number,
      title: d.title,
      area: d.area,
      date: d.date,
      items: items
        .filter((i) => i.day_id === d.id)
        .map((i) => ({
          id: i.id, kind: i.kind, catalogRef: i.catalog_ref, title: i.title, description: i.description ?? "", area: i.area,
          durationHours: i.duration_hours, estCost: i.est_cost, reason: i.reason,
        })),
    })),
    hotel: parseJson<HotelSelection>(row.hotel_json, {} as HotelSelection),
    transport: parseJson<TransportPlan>(row.transport_json, {} as TransportPlan),
    budget: parseJson<BudgetBreakdown>(row.budget_json, {} as BudgetBreakdown),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function latestItineraryForTrip(tripId: string): Itinerary | undefined {
  const row = get<{ id: string }>("SELECT id FROM itineraries WHERE trip_id = ? ORDER BY version DESC LIMIT 1", [tripId]);
  return row ? getItinerary(row.id) : undefined;
}

/** Cheap lookup (one indexed query) when only the latest itinerary's id/version/total are needed. */
export function latestItinerarySummary(tripId: string): { id: string; version: number; total: number } | undefined {
  return get<{ id: string; version: number; total: number }>(
    "SELECT id, version, total_estimate AS total FROM itineraries WHERE trip_id = ? ORDER BY version DESC LIMIT 1",
    [tripId],
  );
}

export function nextItineraryVersion(tripId: string): number {
  return (get<{ v: number | null }>("SELECT MAX(version) v FROM itineraries WHERE trip_id = ?", [tripId])?.v ?? 0) + 1;
}
