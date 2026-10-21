import "server-only";
import { all, get } from "@/lib/db";
import type { ActorIdentity } from "@/lib/auth/permissions";

/**
 * Customers are derived from the shared data model: registered customer
 * accounts, plus guests identified by the anonymous session that planned trips
 * (their name/email come from the lead they created). Keys: `user:<id>` / `guest:<anonId>`.
 */

export interface CustomerSummary {
  key: string;
  kind: "registered" | "guest";
  name: string;
  email: string | null;
  phone: string | null;
  trips: number;
  open_leads: number;
  open_tickets: number;
  pipeline_value: number | null;
  last_activity_at: string;
  is_demo: number;
}

// Set-based aggregation (one grouped pass per table) — replaces correlated OR subqueries that
// could not use indexes (332 ms → 18 ms at ~9k rows per table; see docs/perf/scale-test.json).
const SUMMARY_SQL = `
WITH guests AS (
  SELECT l.anon_id, MAX(l.name) AS name, MAX(l.email) AS email, MAX(l.phone) AS phone, MIN(l.is_demo) AS is_demo
  FROM leads l WHERE l.user_id IS NULL AND l.anon_id IS NOT NULL GROUP BY l.anon_id
),
customers AS (
  SELECT 'user:' || u.id AS key, 'registered' AS kind, u.name, u.email, u.phone, 0 AS is_demo, u.created_at AS created_at
  FROM users u WHERE u.role = 'customer'
  UNION ALL
  SELECT 'guest:' || g.anon_id, 'guest', g.name, g.email, g.phone, g.is_demo, NULL FROM guests g
),
trip_agg AS (
  SELECT CASE WHEN user_id IS NOT NULL THEN 'user:' || user_id ELSE 'guest:' || anon_id END AS key, COUNT(*) AS trips, MAX(updated_at) AS last_trip
  FROM trips WHERE user_id IS NOT NULL OR anon_id IS NOT NULL GROUP BY key
),
lead_agg AS (
  SELECT CASE WHEN user_id IS NOT NULL THEN 'user:' || user_id ELSE 'guest:' || anon_id END AS key, COUNT(*) AS open_leads, SUM(estimated_value) AS pipeline_value
  FROM leads WHERE stage NOT IN ('won','lost') AND (user_id IS NOT NULL OR anon_id IS NOT NULL) GROUP BY key
),
ticket_agg AS (
  SELECT CASE WHEN user_id IS NOT NULL THEN 'user:' || user_id ELSE 'guest:' || anon_id END AS key, COUNT(*) AS open_tickets
  FROM support_tickets WHERE status NOT IN ('resolved','closed') AND (user_id IS NOT NULL OR anon_id IS NOT NULL) GROUP BY key
)
SELECT c.key, c.kind, c.name, c.email, c.phone,
  COALESCE(ta.trips, 0) AS trips,
  COALESCE(la.open_leads, 0) AS open_leads,
  COALESCE(tk.open_tickets, 0) AS open_tickets,
  la.pipeline_value AS pipeline_value,
  COALESCE(ta.last_trip, c.created_at, '') AS last_activity_at,
  c.is_demo
FROM customers c
LEFT JOIN trip_agg ta ON ta.key = c.key
LEFT JOIN lead_agg la ON la.key = c.key
LEFT JOIN ticket_agg tk ON tk.key = c.key
`;

export function listCustomers(f: { q?: string; kind?: string; limit: number; offset: number }): { items: CustomerSummary[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q) {
    where.push("(name LIKE ? OR email LIKE ?)");
    params.push(`%${f.q}%`, `%${f.q}%`);
  }
  if (f.kind === "registered" || f.kind === "guest") {
    where.push("kind = ?");
    params.push(f.kind);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = get<{ c: number }>(`SELECT COUNT(*) c FROM (${SUMMARY_SQL}) ${whereSql}`, params)?.c ?? 0;
  const items = all<CustomerSummary>(`SELECT * FROM (${SUMMARY_SQL}) ${whereSql} ORDER BY last_activity_at DESC LIMIT ? OFFSET ?`, [...params, f.limit, f.offset]);
  return { items, total };
}

export function parseCustomerKey(key: string): ActorIdentity | null {
  const m = /^(user|guest):([A-Za-z0-9_-]{4,64})$/.exec(key);
  if (!m) return null;
  return m[1] === "user" ? { userId: m[2], role: "customer", anonId: "" } : { userId: null, role: null, anonId: m[2] };
}

export function getCustomer(key: string) {
  const owner = parseCustomerKey(key);
  if (!owner) return undefined;
  const summary = get<CustomerSummary>(`SELECT * FROM (${SUMMARY_SQL}) WHERE key = ?`, [key]);
  if (!summary) return undefined;
  const ownerSql = owner.userId ? "x.user_id = ?" : "x.user_id IS NULL AND x.anon_id = ?";
  const ownerParam = owner.userId ?? owner.anonId;
  return {
    customer: summary,
    trips: all<{ id: string; title: string; status: string; estimated_total: number | null; updated_at: string }>(
      `SELECT x.id, x.title, x.status, x.estimated_total, x.updated_at FROM trips x WHERE ${ownerSql} ORDER BY x.updated_at DESC LIMIT 50`,
      [ownerParam],
    ),
    leads: all<{ id: string; destination: string | null; stage: string; score: number; estimated_value: number | null; assignee_name: string | null }>(
      `SELECT x.id, x.destination, x.stage, x.score, x.estimated_value, u.name AS assignee_name FROM leads x LEFT JOIN users u ON u.id = x.assigned_to WHERE ${ownerSql} ORDER BY x.created_at DESC LIMIT 50`,
      [ownerParam],
    ),
    tickets: all<{ id: string; ref: string; subject: string; status: string; priority: string; updated_at: string }>(
      `SELECT x.id, x.ref, x.subject, x.status, x.priority, x.updated_at FROM support_tickets x WHERE ${ownerSql} ORDER BY x.updated_at DESC LIMIT 50`,
      [ownerParam],
    ),
    conversations: all<{ id: string; kind: string; summary: string | null; trip_id: string | null; updated_at: string; messages: number }>(
      `SELECT x.id, x.kind, x.summary, x.trip_id, x.updated_at, (SELECT COUNT(*) FROM conversation_messages m WHERE m.conversation_id = x.id) AS messages
       FROM conversations x WHERE ${ownerSql} AND x.kind IN ('planner','support') ORDER BY x.updated_at DESC LIMIT 20`,
      [ownerParam],
    ),
  };
}

/** Finds the customer key for a lead (used by tools that start from a lead). */
export function customerKeyForLead(lead: { user_id: string | null; anon_id: string | null }): string | null {
  if (lead.user_id) return `user:${lead.user_id}`;
  if (lead.anon_id) return `guest:${lead.anon_id}`;
  return null;
}
