import "server-only";
import { all, get, newId, nowIso, run, tx } from "@/lib/db";
import type { BookingProviderResult } from "@/lib/providers/booking";
import { recordAudit, type AuditActor } from "./audit";

export const OPS_STATUSES = ["pending", "in_review", "quote_sent", "customer_accepted", "failed", "cancelled"] as const;
export type OpsStatus = (typeof OPS_STATUSES)[number];

export const OPS_STATUS_LABELS: Record<OpsStatus, string> = {
  pending: "Pending review",
  in_review: "In review",
  quote_sent: "Quote sent",
  customer_accepted: "Customer accepted quote",
  failed: "Failed",
  cancelled: "Cancelled",
};

const OPS_TRANSITIONS: Record<OpsStatus, OpsStatus[]> = {
  pending: ["in_review", "failed", "cancelled"],
  in_review: ["quote_sent", "failed", "cancelled"],
  quote_sent: ["customer_accepted", "in_review", "failed", "cancelled"],
  customer_accepted: ["cancelled"],
  failed: ["in_review"],
  cancelled: [],
};

export function canTransitionOps(from: OpsStatus, to: OpsStatus) {
  return OPS_TRANSITIONS[from].includes(to);
}

export function allowedOpsTransitions(from: OpsStatus): OpsStatus[] {
  return OPS_TRANSITIONS[from];
}

export interface HandoffRow {
  id: string;
  trip_id: string;
  itinerary_id: string | null;
  requested_by_user_id: string | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  notes: string | null;
  customer_confirmed_at: string;
  confirmation_text: string;
  idempotency_key: string;
  provider: string;
  provider_status: BookingProviderResult["providerStatus"];
  provider_reference: string | null;
  ops_status: OpsStatus;
  assigned_to: string | null;
  quoted_total: number | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface HandoffListItem extends HandoffRow {
  trip_title: string;
  destination_name: string | null;
  start_date: string | null;
  travellers: number | null;
  estimated_total: number | null;
  assignee_name: string | null;
}

const LIST_SELECT = `
  SELECT h.*, t.title AS trip_title, t.destination_name, t.start_date, t.travellers, t.estimated_total, u.name AS assignee_name
  FROM booking_handoffs h JOIN trips t ON t.id = h.trip_id LEFT JOIN users u ON u.id = h.assigned_to`;

export function getHandoffByKey(key: string): HandoffRow | undefined {
  return get<HandoffRow>("SELECT * FROM booking_handoffs WHERE idempotency_key = ?", [key]);
}

export function latestHandoffForTrip(tripId: string): HandoffListItem | undefined {
  return get<HandoffListItem>(`${LIST_SELECT} WHERE h.trip_id = ? ORDER BY h.created_at DESC LIMIT 1`, [tripId]);
}

export function getHandoff(id: string): HandoffListItem | undefined {
  return get<HandoffListItem>(`${LIST_SELECT} WHERE h.id = ?`, [id]);
}

export function insertHandoff(input: {
  tripId: string;
  itineraryId: string | null;
  requestedByUserId: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  notes: string | null;
  confirmationText: string;
  idempotencyKey: string;
  provider: string;
  result: BookingProviderResult;
}): HandoffRow {
  const id = newId("hof");
  const now = nowIso();
  run(
    `INSERT INTO booking_handoffs (id, trip_id, itinerary_id, requested_by_user_id, contact_name, contact_email, contact_phone, notes,
       customer_confirmed_at, confirmation_text, idempotency_key, provider, provider_status, provider_reference, ops_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id, input.tripId, input.itineraryId, input.requestedByUserId, input.contactName, input.contactEmail, input.contactPhone, input.notes,
      now, input.confirmationText, input.idempotencyKey, input.provider, input.result.providerStatus, input.result.providerReference, now, now,
    ],
  );
  return get<HandoffRow>("SELECT * FROM booking_handoffs WHERE id = ?", [id])!;
}

export function listHandoffs(f: { status?: string; q?: string; limit: number; offset: number }): { items: HandoffListItem[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status) {
    where.push("h.ops_status = ?");
    params.push(f.status);
  }
  if (f.q) {
    where.push("(t.title LIKE ? OR h.contact_name LIKE ? OR h.contact_email LIKE ? OR t.destination_name LIKE ?)");
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = get<{ c: number }>(`SELECT COUNT(*) c FROM booking_handoffs h JOIN trips t ON t.id = h.trip_id ${whereSql}`, params)?.c ?? 0;
  const items = all<HandoffListItem>(`${LIST_SELECT} ${whereSql} ORDER BY h.created_at DESC LIMIT ? OFFSET ?`, [...params, f.limit, f.offset]);
  return { items, total };
}

export function handoffStatusCounts(): Record<string, number> {
  return Object.fromEntries(all<{ ops_status: string; c: number }>("SELECT ops_status, COUNT(*) c FROM booking_handoffs GROUP BY ops_status").map((r) => [r.ops_status, r.c]));
}

export class HandoffError extends Error {
  constructor(message: string, readonly code: "invalid_transition" | "not_found") {
    super(message);
  }
}

/**
 * Operational updates by staff. Provider status is deliberately NOT editable
 * here: only a provider adapter can record a provider confirmation.
 */
export function updateHandoff(actor: AuditActor, id: string, patch: { opsStatus?: OpsStatus; assignedTo?: string | null; quotedTotal?: number | null; note?: string | null }): HandoffListItem {
  const h = get<HandoffRow>("SELECT * FROM booking_handoffs WHERE id = ?", [id]);
  if (!h) throw new HandoffError("Booking handoff not found", "not_found");
  return tx(() => {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (patch.opsStatus && patch.opsStatus !== h.ops_status) {
      if (!canTransitionOps(h.ops_status, patch.opsStatus)) throw new HandoffError(`Can't move from “${h.ops_status}” to “${patch.opsStatus}”`, "invalid_transition");
      run("UPDATE booking_handoffs SET ops_status = ? WHERE id = ?", [patch.opsStatus, id]);
      before.opsStatus = h.ops_status;
      after.opsStatus = patch.opsStatus;
      if (patch.opsStatus === "cancelled") run("UPDATE trips SET status = 'saved', updated_at = ? WHERE id = ? AND status = 'handoff_requested'", [nowIso(), h.trip_id]);
    }
    if (patch.assignedTo !== undefined && patch.assignedTo !== h.assigned_to) {
      run("UPDATE booking_handoffs SET assigned_to = ? WHERE id = ?", [patch.assignedTo, id]);
      before.assignedTo = h.assigned_to;
      after.assignedTo = patch.assignedTo;
    }
    if (patch.quotedTotal !== undefined && patch.quotedTotal !== h.quoted_total) {
      run("UPDATE booking_handoffs SET quoted_total = ? WHERE id = ?", [patch.quotedTotal, id]);
      before.quotedTotal = h.quoted_total;
      after.quotedTotal = patch.quotedTotal;
    }
    if (patch.note) after.note = patch.note;
    run("UPDATE booking_handoffs SET updated_at = ? WHERE id = ?", [nowIso(), id]);
    if (Object.keys(after).length) recordAudit(actor, "booking_handoff", id, patch.note && Object.keys(after).length === 1 ? "note" : "updated", before, after);
    return getHandoff(id)!;
  });
}
