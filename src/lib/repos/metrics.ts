import "server-only";
import { all, get } from "@/lib/db";

/**
 * Dashboard and analytics aggregation. Pure SQL over stored records: no AI.
 * Every result reports how many underlying records are seeded demo data so the
 * UI can label it honestly.
 */

const DAY = 86_400_000;

/** A planning session counts once the customer has actually said something (opening the planner alone is not a session). */
const ENGAGED = "(t.is_demo = 1 OR EXISTS (SELECT 1 FROM conversations c JOIN conversation_messages m ON m.conversation_id = c.id WHERE c.trip_id = t.id AND m.role = 'user'))";

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function count(sql: string, params: (string | number)[] = []): number {
  return get<{ c: number }>(sql, params)?.c ?? 0;
}

export interface Range {
  from: string; // ISO
  to: string; // ISO (exclusive)
}

export function defaultRange(days = 30): Range {
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  return { from: iso(end.getTime() - days * DAY + 1), to: iso(end.getTime() + 1) };
}

export function funnel(r: Range) {
  const p = [r.from, r.to];
  const sessions = count(`SELECT COUNT(*) c FROM trips t WHERE t.created_at >= ? AND t.created_at < ? AND ${ENGAGED}`, p);
  const itineraries = count("SELECT COUNT(DISTINCT trip_id) c FROM itineraries i JOIN trips t ON t.id = i.trip_id WHERE t.created_at >= ? AND t.created_at < ?", p);
  const saved = count("SELECT COUNT(*) c FROM trips WHERE created_at >= ? AND created_at < ? AND status IN ('saved','handoff_requested','booked','completed')", p);
  const handoffs = count("SELECT COUNT(DISTINCT h.trip_id) c FROM booking_handoffs h JOIN trips t ON t.id = h.trip_id WHERE t.created_at >= ? AND t.created_at < ?", p);
  const won = count("SELECT COUNT(*) c FROM leads WHERE created_at >= ? AND created_at < ? AND stage = 'won'", p);
  return [
    { stage: "Planning sessions", value: sessions },
    { stage: "Itinerary generated", value: itineraries },
    { stage: "Trip saved", value: saved },
    { stage: "Booking requested", value: handoffs },
    { stage: "Won (sales)", value: won },
  ];
}

export function popularDestinations(r: Range, limit = 8) {
  return all<{ destination: string; trips: number }>(
    `SELECT COALESCE(t.destination_name, 'Undecided') destination, COUNT(*) trips FROM trips t
     WHERE t.created_at >= ? AND t.created_at < ? AND ${ENGAGED} GROUP BY destination ORDER BY trips DESC LIMIT ?`,
    [r.from, r.to, limit],
  );
}

export function dailySeries(r: Range) {
  const rows = new Map<string, { date: string; trips: number; leads: number; won: number; handoffs: number; tickets: number; itineraries: number }>();
  for (let t = Date.parse(r.from); t < Date.parse(r.to); t += DAY) {
    const d = iso(t).slice(0, 10);
    rows.set(d, { date: d, trips: 0, leads: 0, won: 0, handoffs: 0, tickets: 0, itineraries: 0 });
  }
  const add = (sql: string, key: "trips" | "leads" | "won" | "handoffs" | "tickets" | "itineraries") => {
    for (const row of all<{ d: string; c: number }>(sql, [r.from, r.to])) {
      const target = rows.get(row.d);
      if (target) target[key] = row.c;
    }
  };
  add(`SELECT substr(t.created_at, 1, 10) d, COUNT(*) c FROM trips t WHERE t.created_at >= ? AND t.created_at < ? AND ${ENGAGED} GROUP BY d`, "trips");
  add("SELECT substr(created_at, 1, 10) d, COUNT(*) c FROM leads WHERE created_at >= ? AND created_at < ? GROUP BY d", "leads");
  add("SELECT substr(updated_at, 1, 10) d, COUNT(*) c FROM leads WHERE stage = 'won' AND updated_at >= ? AND updated_at < ? GROUP BY d", "won");
  add("SELECT substr(created_at, 1, 10) d, COUNT(*) c FROM booking_handoffs WHERE created_at >= ? AND created_at < ? GROUP BY d", "handoffs");
  add("SELECT substr(created_at, 1, 10) d, COUNT(*) c FROM support_tickets WHERE created_at >= ? AND created_at < ? GROUP BY d", "tickets");
  add("SELECT substr(created_at, 1, 10) d, COUNT(*) c FROM itineraries WHERE created_at >= ? AND created_at < ? GROUP BY d", "itineraries");
  return Array.from(rows.values());
}

export function demoShare() {
  const total = count("SELECT COUNT(*) c FROM trips") + count("SELECT COUNT(*) c FROM leads") + count("SELECT COUNT(*) c FROM support_tickets");
  const demo =
    count("SELECT COUNT(*) c FROM trips WHERE is_demo = 1") + count("SELECT COUNT(*) c FROM leads WHERE is_demo = 1") + count("SELECT COUNT(*) c FROM support_tickets WHERE is_demo = 1");
  return { total, demo, live: total - demo };
}

const ACTIVITY_LABELS: Record<string, string> = {
  "lead:created": "New lead created",
  "lead:stage_changed": "Lead stage changed",
  "lead:assigned": "Lead assigned",
  "ticket:created": "Support ticket opened",
  "ticket:updated": "Support ticket updated",
  "booking_handoff:requested": "Booking request submitted",
  "booking_handoff:updated": "Booking request updated",
  "booking_handoff:note": "Operations note added",
  "itinerary:generated": "Itinerary generated",
  "ai_action:confirmed": "AI action confirmed",
  "ai_action:rejected": "AI action rejected",
  "ai_action:failed": "AI action failed",
};
const ACTIVITY_HREF: Record<string, (id: string) => string> = {
  lead: (id) => `/admin/leads?lead=${id}`,
  ticket: (id) => `/admin/support?ticket=${id}`,
};

/** Recent business activity from the audit log (persisted events only). */
export function recentActivity(limit = 10) {
  const rows = all<{ id: string; actor_label: string; entity_type: string; entity_id: string; action: string; created_at: string }>(
    `SELECT id, actor_label, entity_type, entity_id, action, created_at FROM audit_events
     WHERE entity_type IN ('lead','ticket','booking_handoff','itinerary','ai_action') AND action NOT LIKE 'edit:%'
     ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.entity_type,
    title: ACTIVITY_LABELS[`${r.entity_type}:${r.action}`] ?? `${r.entity_type.replace(/_/g, " ")} ${r.action.replace(/_/g, " ")}`,
    actor: r.actor_label,
    at: r.created_at,
    href: ACTIVITY_HREF[r.entity_type]?.(r.entity_id) ?? null,
  }));
}

export function dashboardOverview(days = 30) {
  const now = Date.now();
  const last7 = iso(now - 7 * DAY);
  const prev7 = iso(now - 14 * DAY);
  const endOfToday = new Date();
  endOfToday.setUTCHours(23, 59, 59, 999);
  const range = defaultRange(days);
  const conv = (from: string, to: string) => {
    const leads = count("SELECT COUNT(*) c FROM leads WHERE created_at >= ? AND created_at < ?", [from, to]);
    const withBookingRequest = count(
      "SELECT COUNT(DISTINCT l.id) c FROM leads l JOIN booking_handoffs h ON h.trip_id = l.trip_id WHERE l.created_at >= ? AND l.created_at < ?",
      [from, to],
    );
    return { leads, withBookingRequest, pct: leads ? Math.round((withBookingRequest / leads) * 1000) / 10 : null };
  };
  const current = conv(range.from, range.to);
  const previous = conv(iso(Date.parse(range.from) - days * DAY), range.from);
  return {
    days,
    conversion: { ...current, previousPct: previous.pct, previousLeads: previous.leads },
    activity: recentActivity(),
    kpis: {
      newLeads: count("SELECT COUNT(*) c FROM leads WHERE created_at >= ?", [last7]),
      newLeadsPrev: count("SELECT COUNT(*) c FROM leads WHERE created_at >= ? AND created_at < ?", [prev7, last7]),
      activeTripPlans: count(`SELECT COUNT(*) c FROM trips t WHERE t.status IN ('planning','itinerary_ready','saved') AND t.updated_at >= ? AND ${ENGAGED}`, [iso(now - 30 * DAY)]),
      bookingHandoffsOpen: count("SELECT COUNT(*) c FROM booking_handoffs WHERE ops_status IN ('pending','in_review','quote_sent')"),
      bookingHandoffsPending: count("SELECT COUNT(*) c FROM booking_handoffs WHERE ops_status = 'pending'"),
      openTickets: count("SELECT COUNT(*) c FROM support_tickets WHERE status NOT IN ('resolved','closed')"),
      urgentTickets: count("SELECT COUNT(*) c FROM support_tickets WHERE status NOT IN ('resolved','closed') AND priority = 'urgent'"),
      followUpsDue: count("SELECT COUNT(*) c FROM follow_ups WHERE status = 'pending' AND due_at <= ?", [endOfToday.toISOString()]),
      followUpsOverdue: count("SELECT COUNT(*) c FROM follow_ups WHERE status = 'pending' AND due_at < ?", [iso(now)]),
    },
    funnel: funnel(range),
    popularDestinations: popularDestinations(range, 6),
    series: dailySeries(range),
    recentLeads: all<{ id: string; name: string; destination: string | null; stage: string; score: number; created_at: string; is_demo: number }>(
      "SELECT id, name, destination, stage, score, created_at, is_demo FROM leads ORDER BY created_at DESC LIMIT 6",
    ),
    urgentQueue: all<{ id: string; ref: string; subject: string; priority: string; status: string; created_at: string }>(
      `SELECT id, ref, subject, priority, status, created_at FROM support_tickets WHERE status NOT IN ('resolved','closed')
       ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at ASC LIMIT 5`,
    ),
    dueFollowUps: all<{ id: string; lead_id: string; lead_name: string; channel: string; due_at: string; note: string | null }>(
      `SELECT f.id, f.lead_id, l.name lead_name, f.channel, f.due_at, f.note FROM follow_ups f JOIN leads l ON l.id = f.lead_id
       WHERE f.status = 'pending' AND f.due_at <= ? ORDER BY f.due_at ASC LIMIT 6`,
      [endOfToday.toISOString()],
    ),
    data: demoShare(),
  };
}

/** Headline KPIs for a period, in a handful of aggregate queries (also used for trend comparisons). */
export function headlineKpis(r: Range) {
  const p = [r.from, r.to];
  const l = get<{ leads: number; won: number | null; lost: number | null }>(
    "SELECT COUNT(*) leads, SUM(stage = 'won') won, SUM(stage = 'lost') lost FROM leads WHERE created_at >= ? AND created_at < ?",
    p,
  )!;
  const leadsWithHandoff = count(
    "SELECT COUNT(DISTINCT l.id) c FROM leads l JOIN booking_handoffs h ON h.trip_id = l.trip_id WHERE l.created_at >= ? AND l.created_at < ?",
    p,
  );
  const sessions = count(`SELECT COUNT(*) c FROM trips t WHERE t.created_at >= ? AND t.created_at < ? AND ${ENGAGED}`, p);
  const completed = count("SELECT COUNT(DISTINCT i.trip_id) c FROM itineraries i JOIN trips t ON t.id = i.trip_id WHERE t.created_at >= ? AND t.created_at < ?", p);
  const tickets = get<{ total: number; resolved: number; avg_first_min: number | null; avg_resolve_h: number | null; csat: number | null; csat_n: number }>(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) resolved,
            AVG(CASE WHEN first_response_at IS NOT NULL THEN (julianday(first_response_at) - julianday(created_at)) * 1440 END) avg_first_min,
            AVG(CASE WHEN resolved_at IS NOT NULL THEN (julianday(resolved_at) - julianday(created_at)) * 24 END) avg_resolve_h,
            AVG(csat_score) csat, COUNT(csat_score) csat_n
     FROM support_tickets WHERE created_at >= ? AND created_at < ?`,
    p,
  )!;
  const tripValue = get<{ avg: number | null; sum: number | null }>(
    "SELECT AVG(estimated_total) avg, SUM(estimated_total) sum FROM trips WHERE created_at >= ? AND created_at < ? AND estimated_total IS NOT NULL",
    p,
  )!;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const leads = l.leads ?? 0;
  const won = l.won ?? 0;
  return {
    leadConversion: { leads, won, lost: l.lost ?? 0, leadsWithHandoff, leadToBookingRequestPct: pct(leadsWithHandoff, leads), leadToWonPct: pct(won, leads) },
    planningCompletion: { sessions, completed, completionPct: pct(completed, sessions) },
    tickets,
    support: {
      tickets: tickets.total ?? 0,
      resolved: tickets.resolved ?? 0,
      resolutionPct: pct(tickets.resolved ?? 0, tickets.total ?? 0),
      avgFirstResponseMinutes: tickets.avg_first_min !== null ? Math.round(tickets.avg_first_min) : null,
      avgResolutionHours: tickets.avg_resolve_h !== null ? Math.round(tickets.avg_resolve_h * 10) / 10 : null,
    },
    satisfaction: { avgCsat: tickets.csat !== null ? Math.round(tickets.csat * 10) / 10 : null, responses: tickets.csat_n ?? 0 },
    avgEstimatedTripValue: tripValue.avg ? Math.round(tripValue.avg) : null,
    estimatedTripValueSum: tripValue.sum ?? 0,
  };
}

export function analyticsReport(r: Range) {
  const p = [r.from, r.to];
  const h = headlineKpis(r);
  const byPriority = all<{ priority: string; tickets: number; avg_first_min: number | null }>(
    `SELECT priority, COUNT(*) tickets, AVG(CASE WHEN first_response_at IS NOT NULL THEN (julianday(first_response_at) - julianday(created_at)) * 1440 END) avg_first_min
     FROM support_tickets WHERE created_at >= ? AND created_at < ? GROUP BY priority`,
    p,
  );
  const pipeline = get<{ v: number | null }>("SELECT SUM(estimated_value) v FROM leads WHERE created_at >= ? AND created_at < ? AND stage NOT IN ('won','lost')", p)?.v ?? 0;
  const handoffValue = get<{ accepted: number | null; confirmed: number | null; confirmed_n: number }>(
    `SELECT SUM(CASE WHEN ops_status = 'customer_accepted' AND provider_status <> 'provider_confirmed' THEN quoted_total END) accepted,
            SUM(CASE WHEN provider_status = 'provider_confirmed' THEN COALESCE(quoted_total, 0) END) confirmed,
            SUM(provider_status = 'provider_confirmed') confirmed_n
     FROM booking_handoffs WHERE created_at >= ? AND created_at < ?`,
    p,
  )!;
  // Value is reported in three clearly separated tiers; only provider-confirmed bookings count as revenue.
  const value = {
    estimatedTripValue: h.estimatedTripValueSum,
    openPipelineEstimate: pipeline,
    acceptedQuotesUnconfirmed: handoffValue.accepted ?? 0,
    confirmedRevenue: handoffValue.confirmed ?? 0,
    providerConfirmedBookings: handoffValue.confirmed_n ?? 0,
  };
  return {
    range: r,
    value,
    leadConversion: h.leadConversion,
    planningCompletion: h.planningCompletion,
    support: { ...h.support, byPriority: byPriority.map((b) => ({ ...b, avg_first_min: b.avg_first_min !== null ? Math.round(b.avg_first_min) : null })) },
    satisfaction: h.satisfaction,
    avgEstimatedTripValue: h.avgEstimatedTripValue,
    popularDestinations: popularDestinations(r, 10),
    series: dailySeries(r),
    data: demoShare(),
  };
}

export function seriesToCsv(series: ReturnType<typeof dailySeries>): string {
  const header = "date,planning_sessions,itineraries,leads,leads_won,booking_requests,support_tickets";
  const lines = series.map((s) => [s.date, s.trips, s.itineraries, s.leads, s.won, s.handoffs, s.tickets].join(","));
  return [header, ...lines].join("\n") + "\n";
}
