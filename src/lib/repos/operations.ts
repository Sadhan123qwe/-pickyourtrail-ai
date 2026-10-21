import "server-only";
import { all, get } from "@/lib/db";

/**
 * Operational queues for the AI Command Center and the AI tools. Pure SQL over
 * persisted records — no AI is involved in computing any of these lists.
 */

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

export interface StalledLead {
  id: string;
  name: string;
  email: string | null;
  destination: string | null;
  stage: string;
  score: number;
  estimated_value: number | null;
  assignee_name: string | null;
  trip_id: string;
  trip_title: string;
  trip_status: string;
  itinerary_total: number | null;
  last_activity_at: string;
  is_demo: number;
}

/** Open leads whose customer generated an itinerary but never requested a booking. */
export function stalledLeads(limit = 20): StalledLead[] {
  return all<StalledLead>(
    `SELECT l.id, l.name, l.email, l.destination, l.stage, l.score, l.estimated_value, u.name AS assignee_name,
            t.id AS trip_id, t.title AS trip_title, t.status AS trip_status, t.estimated_total AS itinerary_total,
            l.updated_at AS last_activity_at, l.is_demo
     FROM leads l
     JOIN trips t ON t.id = l.trip_id
     LEFT JOIN users u ON u.id = l.assigned_to
     WHERE l.stage IN ('new','contacted','qualified','proposal_sent')
       AND t.status IN ('itinerary_ready','saved')
       AND EXISTS (SELECT 1 FROM itineraries i WHERE i.trip_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM booking_handoffs h WHERE h.trip_id = t.id)
     ORDER BY COALESCE(l.estimated_value, 0) DESC, l.updated_at ASC
     LIMIT ?`,
    [limit],
  );
}

export interface OverBudgetTrip {
  trip_id: string;
  title: string;
  status: string;
  itinerary_id: string;
  total: number;
  budget_inr: number;
  over_by: number;
  over_pct: number;
  customer: string | null;
  lead_id: string | null;
  is_demo: number;
}

/** Latest itinerary per trip whose estimate exceeds the customer's stated budget (computed in code at generation time). */
export function overBudgetTrips(limit = 20): OverBudgetTrip[] {
  return all<OverBudgetTrip>(
    `SELECT t.id AS trip_id, t.title, t.status, i.id AS itinerary_id,
            CAST(json_extract(i.budget_json, '$.comparison.comparableTotal') AS INTEGER) AS total,
            CAST(json_extract(i.budget_json, '$.comparison.budgetInr') AS INTEGER) AS budget_inr,
            CAST(json_extract(i.budget_json, '$.comparison.comparableTotal') - json_extract(i.budget_json, '$.comparison.budgetInr') AS INTEGER) AS over_by,
            CAST(ROUND((json_extract(i.budget_json, '$.comparison.comparableTotal') * 100.0 / json_extract(i.budget_json, '$.comparison.budgetInr')) - 100) AS INTEGER) AS over_pct,
            (SELECT l.name FROM leads l WHERE l.trip_id = t.id ORDER BY l.created_at DESC LIMIT 1) AS customer,
            (SELECT l.id FROM leads l WHERE l.trip_id = t.id ORDER BY l.created_at DESC LIMIT 1) AS lead_id,
            t.is_demo
     FROM trips t
     JOIN itineraries i ON i.trip_id = t.id AND i.version = (SELECT MAX(version) FROM itineraries WHERE trip_id = t.id)
     WHERE t.status NOT IN ('cancelled','completed')
       AND json_extract(i.budget_json, '$.comparison.status') = 'over'
     ORDER BY over_pct DESC
     LIMIT ?`,
    [limit],
  );
}

export interface SupportCase {
  id: string;
  ref: string;
  subject: string;
  priority: string;
  status: string;
  category: string;
  escalated: number;
  assignee_name: string | null;
  customer: string | null;
  first_response_at: string | null;
  created_at: string;
  reason: string;
}

/** Tickets needing urgent attention: urgent/escalated, or high priority still awaiting a first human response. */
export function urgentSupportCases(limit = 20): SupportCase[] {
  return all<SupportCase>(
    `SELECT t.id, t.ref, t.subject, t.priority, t.status, t.category, t.escalated, a.name AS assignee_name,
            COALESCE(c.name, t.contact_email) AS customer, t.first_response_at, t.created_at,
            CASE WHEN t.priority = 'urgent' THEN 'Urgent travel problem'
                 WHEN t.escalated = 1 THEN 'Escalated: ' || COALESCE(t.escalation_reason, 'needs review')
                 WHEN t.first_response_at IS NULL THEN 'High priority with no first response yet'
                 ELSE 'Needs attention' END AS reason
     FROM support_tickets t
     LEFT JOIN users a ON a.id = t.assigned_to
     LEFT JOIN users c ON c.id = t.user_id
     WHERE t.status NOT IN ('resolved','closed')
       AND (t.priority = 'urgent' OR t.escalated = 1 OR (t.priority = 'high' AND t.first_response_at IS NULL) OR t.assigned_to IS NULL AND t.priority IN ('urgent','high'))
     ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.created_at ASC
     LIMIT ?`,
    [limit],
  );
}

export function tripsAwaitingReview(limit = 20) {
  return all<{ id: string; title: string; updated_at: string; estimated_total: number | null; customer: string | null; is_demo: number }>(
    `SELECT t.id, t.title, t.updated_at, t.estimated_total, COALESCE(u.name, (SELECT l.name FROM leads l WHERE l.trip_id = t.id LIMIT 1)) AS customer, t.is_demo
     FROM trips t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.status = 'itinerary_ready'
     ORDER BY t.updated_at DESC LIMIT ?`,
    [limit],
  );
}

export function handoffsNeedingAction(limit = 20) {
  return all<{ id: string; trip_id: string; trip_title: string; contact_name: string; ops_status: string; assignee_name: string | null; created_at: string; age_hours: number; is_demo: number }>(
    `SELECT h.id, h.trip_id, t.title AS trip_title, h.contact_name, h.ops_status, u.name AS assignee_name, h.created_at,
            CAST((julianday('now') - julianday(h.created_at)) * 24 AS INTEGER) AS age_hours, h.is_demo
     FROM booking_handoffs h JOIN trips t ON t.id = h.trip_id LEFT JOIN users u ON u.id = h.assigned_to
     WHERE h.ops_status IN ('pending','in_review','failed')
     ORDER BY CASE h.ops_status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, h.created_at ASC LIMIT ?`,
    [limit],
  );
}

export function activeConversations(limit = 20, sinceHours = 72) {
  return all<{ id: string; kind: string; trip_id: string | null; trip_title: string | null; summary: string | null; updated_at: string; customer: string | null; messages: number }>(
    `SELECT c.id, c.kind, c.trip_id, t.title AS trip_title, c.summary, c.updated_at,
            COALESCE(u.name, (SELECT l.name FROM leads l WHERE l.trip_id = c.trip_id LIMIT 1), 'Website visitor') AS customer,
            (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = c.id) AS messages
     FROM conversations c LEFT JOIN trips t ON t.id = c.trip_id LEFT JOIN users u ON u.id = c.user_id
     WHERE c.kind IN ('planner','support') AND c.status = 'active' AND c.updated_at >= ?
       AND EXISTS (SELECT 1 FROM conversation_messages m WHERE m.conversation_id = c.id AND m.role = 'user')
     ORDER BY c.updated_at DESC LIMIT ?`,
    [iso(Date.now() - sinceHours * HOUR), limit],
  );
}

export function followUpsDue(limit = 20) {
  const endOfToday = new Date();
  endOfToday.setUTCHours(23, 59, 59, 999);
  return all<{ id: string; lead_id: string; lead_name: string; channel: string; due_at: string; note: string | null; assignee_name: string | null; overdue: number }>(
    `SELECT f.id, f.lead_id, l.name AS lead_name, f.channel, f.due_at, f.note, u.name AS assignee_name,
            CASE WHEN f.due_at < ? THEN 1 ELSE 0 END AS overdue
     FROM follow_ups f JOIN leads l ON l.id = f.lead_id LEFT JOIN users u ON u.id = l.assigned_to
     WHERE f.status = 'pending' AND f.due_at <= ? AND l.stage NOT IN ('won','lost')
     ORDER BY f.due_at ASC LIMIT ?`,
    [new Date().toISOString(), endOfToday.toISOString(), limit],
  );
}

export interface ExceptionItem {
  type: "overdue_follow_up" | "urgent_ticket" | "failed_handoff" | "stale_handoff" | "ai_failure" | "failed_action";
  severity: "high" | "medium";
  title: string;
  detail: string;
  entityId: string | null;
  at: string;
}

/** Operational exceptions since `sinceIso` (default: start of today, UTC). */
export function operationalExceptions(sinceIso?: string): ExceptionItem[] {
  const since = sinceIso ?? (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  })();
  const items: ExceptionItem[] = [];
  for (const t of urgentSupportCases(10)) {
    items.push({ type: "urgent_ticket", severity: t.priority === "urgent" ? "high" : "medium", title: `${t.ref}: ${t.subject}`, detail: t.reason, entityId: t.id, at: t.created_at });
  }
  for (const h of all<{ id: string; trip_title: string; updated_at: string }>(
    "SELECT h.id, t.title AS trip_title, h.updated_at FROM booking_handoffs h JOIN trips t ON t.id = h.trip_id WHERE h.ops_status = 'failed' ORDER BY h.updated_at DESC LIMIT 10",
  )) {
    items.push({ type: "failed_handoff", severity: "high", title: `Booking handoff failed: ${h.trip_title}`, detail: "Suppliers couldn't fulfil the request; contact the customer with alternatives.", entityId: h.id, at: h.updated_at });
  }
  for (const h of all<{ id: string; trip_title: string; created_at: string }>(
    "SELECT h.id, t.title AS trip_title, h.created_at FROM booking_handoffs h JOIN trips t ON t.id = h.trip_id WHERE h.ops_status = 'pending' AND h.created_at < ? ORDER BY h.created_at LIMIT 10",
    [iso(Date.now() - 24 * HOUR)],
  )) {
    items.push({ type: "stale_handoff", severity: "medium", title: `Booking request waiting > 24h: ${h.trip_title}`, detail: "No one has reviewed this request yet.", entityId: h.id, at: h.created_at });
  }
  const overdue = get<{ c: number; oldest: string | null }>(
    "SELECT COUNT(*) c, MIN(f.due_at) oldest FROM follow_ups f JOIN leads l ON l.id = f.lead_id WHERE f.status = 'pending' AND f.due_at < ? AND l.stage NOT IN ('won','lost')",
    [new Date().toISOString()],
  );
  if (overdue && overdue.c > 0) {
    items.push({ type: "overdue_follow_up", severity: overdue.c > 10 ? "high" : "medium", title: `${overdue.c} overdue sales follow-ups`, detail: "Leads are waiting for a promised call or message.", entityId: null, at: overdue.oldest ?? new Date().toISOString() });
  }
  const aiFailures = get<{ c: number; last: string | null; codes: string | null }>(
    "SELECT COUNT(*) c, MAX(created_at) last, GROUP_CONCAT(DISTINCT error_code) codes FROM usage_records WHERE created_at >= ? AND outcome IN ('error','fallback','rate_limited')",
    [since],
  );
  if (aiFailures && aiFailures.c > 0) {
    items.push({ type: "ai_failure", severity: "medium", title: `${aiFailures.c} AI requests fell back to the standard planner`, detail: `Error codes: ${aiFailures.codes ?? "unknown"}. Customers were not blocked.`, entityId: null, at: aiFailures.last ?? since });
  }
  for (const a of all<{ id: string; tool: string; error: string | null; created_at: string }>(
    "SELECT id, tool, error, created_at FROM ai_actions WHERE status = 'failed' AND COALESCE(error, '') <> 'forbidden' AND created_at >= ? ORDER BY created_at DESC LIMIT 10",
    [since],
  )) {
    items.push({ type: "failed_action", severity: "high", title: `AI action failed: ${a.tool}`, detail: a.error ?? "Unknown error", entityId: a.id, at: a.created_at });
  }
  return items.sort((x, y) => (x.severity === y.severity ? y.at.localeCompare(x.at) : x.severity === "high" ? -1 : 1));
}
