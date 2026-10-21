import "server-only";
import { all, get, newId, nowIso, parseJson, run, tx } from "@/lib/db";
import { getDestination } from "@/lib/catalog/destinations";
import { totalTravellers, type TripProfile } from "@/lib/planner/profile";
import { summarizeProfile } from "@/lib/planner/engine";
import { canTransitionLead, estimatedLeadValue, scoreLead, type LeadStage } from "@/lib/workflows/rules";
import { recordAudit, type AuditActor } from "./audit";
import type { TripRow } from "./trips";
import { getPreferences } from "./trips";

export interface LeadRow {
  id: string;
  trip_id: string | null;
  user_id: string | null;
  anon_id: string | null;
  conversation_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  destination: string | null;
  travel_month: string | null;
  travellers: number | null;
  budget: number | null;
  currency: string;
  source: "ai_planner" | "support" | "manual" | "website";
  stage: LeadStage;
  score: number;
  estimated_value: number | null;
  assigned_to: string | null;
  next_follow_up_at: string | null;
  lost_reason: string | null;
  dedup_key: string;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface LeadListItem extends LeadRow {
  assignee_name: string | null;
  trip_status: string | null;
}

export class LeadError extends Error {
  constructor(message: string, readonly code: "invalid_transition" | "duplicate" | "not_found") {
    super(message);
  }
}

export function getLead(id: string): LeadListItem | undefined {
  return get<LeadListItem>(
    `SELECT l.*, u.name AS assignee_name, t.status AS trip_status FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN trips t ON t.id = l.trip_id WHERE l.id = ?`,
    [id],
  );
}

export function findOpenLeadByDedupKey(key: string): LeadRow | undefined {
  return get<LeadRow>("SELECT * FROM leads WHERE dedup_key = ? AND stage NOT IN ('won','lost')", [key]);
}

export function addLeadActivity(leadId: string, actorUserId: string | null, type: string, body: string, meta?: unknown) {
  if (type === "profile_updated") {
    // Consecutive preference updates collapse into one entry so the timeline stays readable.
    const last = get<{ id: string; type: string }>("SELECT id, type FROM lead_activities WHERE lead_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", [leadId]);
    if (last?.type === "profile_updated") {
      run("UPDATE lead_activities SET body = ?, created_at = ? WHERE id = ?", [body.slice(0, 2000), nowIso(), last.id]);
      return;
    }
  }
  run(
    "INSERT INTO lead_activities (id, lead_id, actor_user_id, type, body, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [newId("act"), leadId, actorUserId, type, body.slice(0, 2000), meta === undefined ? null : JSON.stringify(meta), nowIso()],
  );
}

/** Round-robin assignment to the sales rep with the fewest open leads. */
function pickSalesRep(): string | null {
  return (
    get<{ id: string }>(
      `SELECT u.id FROM users u LEFT JOIN leads l ON l.assigned_to = u.id AND l.stage NOT IN ('won','lost')
       WHERE u.role = 'sales' GROUP BY u.id ORDER BY COUNT(l.id) ASC, u.name ASC LIMIT 1`,
    )?.id ?? null
  );
}

/**
 * Creates or updates the single open lead for a trip-planning opportunity.
 * Idempotent: repeated calls for the same trip update the same lead.
 */
export function upsertLeadFromTrip(args: {
  trip: TripRow;
  profile: TripProfile;
  conversationId: string | null;
  contact: { name: string | null; email: string | null; phone: string | null };
  hasItinerary: boolean;
  handoffRequested: boolean;
  itineraryTotal: number | null;
}): { lead: LeadRow; created: boolean } {
  const { trip, profile } = args;
  const dedupKey = `trip:${trip.id}`;
  const destination = getDestination(profile.destinationId)?.name ?? (profile.destinationOpen ? "Open to suggestions" : null);
  const score = scoreLead(profile, { hasContact: !!args.contact.email, hasItinerary: args.hasItinerary, handoffRequested: args.handoffRequested });
  const value = estimatedLeadValue(profile, args.itineraryTotal);
  const now = nowIso();
  const travellers = profile.adults !== null ? totalTravellers(profile) : null;
  const travelMonth = profile.startDate?.slice(0, 7) ?? profile.travelMonth;

  return tx(() => {
    const existing = findOpenLeadByDedupKey(dedupKey);
    if (existing) {
      run(
        `UPDATE leads SET destination = ?, travel_month = ?, travellers = ?, budget = ?, currency = ?, score = ?, estimated_value = ?,
           name = CASE WHEN ? IS NOT NULL THEN ? ELSE name END, email = COALESCE(?, email), phone = COALESCE(?, phone),
           user_id = COALESCE(user_id, ?), conversation_id = COALESCE(conversation_id, ?), updated_at = ? WHERE id = ?`,
        [
          destination, travelMonth, travellers, profile.budgetAmount, profile.currency, score, value,
          args.contact.name, args.contact.name, args.contact.email, args.contact.phone, trip.user_id, args.conversationId, now, existing.id,
        ],
      );
      return { lead: get<LeadRow>("SELECT * FROM leads WHERE id = ?", [existing.id])!, created: false };
    }
    const id = newId("lead");
    const assignee = pickSalesRep();
    const followUp = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    run(
      `INSERT INTO leads (id, trip_id, user_id, anon_id, conversation_id, name, email, phone, destination, travel_month, travellers,
         budget, currency, source, stage, score, estimated_value, assigned_to, next_follow_up_at, dedup_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_planner', 'new', ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, trip.id, trip.user_id, trip.anon_id, args.conversationId, args.contact.name ?? `Website visitor ${trip.anon_id?.slice(-4) ?? ""}`.trim(),
        args.contact.email, args.contact.phone, destination, travelMonth, travellers, profile.budgetAmount, profile.currency, score, value,
        assignee, followUp, dedupKey, now, now,
      ],
    );
    addLeadActivity(id, null, "created", `Lead created automatically from the AI trip planner. ${summarizeProfile(profile, {})}`);
    run(
      "INSERT INTO follow_ups (id, lead_id, due_at, channel, note, status, created_by, created_at) VALUES (?, ?, ?, 'call', ?, 'pending', NULL, ?)",
      [newId("fu"), id, followUp, "Introductory call about the trip plan", now],
    );
    recordAudit({ userId: null, label: "AI planner workflow" }, "lead", id, "created", undefined, { tripId: trip.id, stage: "new" });
    return { lead: get<LeadRow>("SELECT * FROM leads WHERE id = ?", [id])!, created: true };
  });
}

export interface LeadFilter {
  q?: string;
  stage?: string;
  assignedTo?: string;
  source?: string;
  sort?: "created_desc" | "score_desc" | "follow_up_asc" | "value_desc";
  limit: number;
  offset: number;
}

export function listLeads(f: LeadFilter): { items: LeadListItem[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q) {
    where.push("(l.name LIKE ? OR l.email LIKE ? OR l.destination LIKE ?)");
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.stage) {
    where.push("l.stage = ?");
    params.push(f.stage);
  }
  if (f.assignedTo) {
    where.push(f.assignedTo === "unassigned" ? "l.assigned_to IS NULL" : "l.assigned_to = ?");
    if (f.assignedTo !== "unassigned") params.push(f.assignedTo);
  }
  if (f.source) {
    where.push("l.source = ?");
    params.push(f.source);
  }
  const order = {
    created_desc: "l.created_at DESC",
    score_desc: "l.score DESC, l.created_at DESC",
    follow_up_asc: "CASE WHEN l.next_follow_up_at IS NULL THEN 1 ELSE 0 END, l.next_follow_up_at ASC",
    value_desc: "COALESCE(l.estimated_value, 0) DESC",
  }[f.sort ?? "created_desc"];
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = get<{ c: number }>(`SELECT COUNT(*) c FROM leads l ${whereSql}`, params)?.c ?? 0;
  const items = all<LeadListItem>(
    `SELECT l.*, u.name AS assignee_name, t.status AS trip_status FROM leads l
     LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN trips t ON t.id = l.trip_id
     ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, f.limit, f.offset],
  );
  return { items, total };
}

export function createManualLead(actor: AuditActor, input: {
  name: string; email?: string | null; phone?: string | null; destination?: string | null; travelMonth?: string | null;
  travellers?: number | null; budget?: number | null; assignedTo?: string | null; note?: string | null;
}): LeadRow {
  const email = input.email?.trim().toLowerCase() || null;
  const dedupKey = email ? `email:${email}:${(input.destination ?? "").toLowerCase()}` : `manual:${newId("k")}`;
  if (findOpenLeadByDedupKey(dedupKey)) throw new LeadError("An open lead already exists for this customer and destination", "duplicate");
  const id = newId("lead");
  const now = nowIso();
  tx(() => {
    run(
      `INSERT INTO leads (id, name, email, phone, destination, travel_month, travellers, budget, currency, source, stage, score,
         estimated_value, assigned_to, dedup_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'INR', 'manual', 'new', ?, ?, ?, ?, ?, ?)`,
      [id, input.name, email, input.phone ?? null, input.destination ?? null, input.travelMonth ?? null, input.travellers ?? null,
        input.budget ?? null, email ? 30 : 15, input.budget ?? null, input.assignedTo ?? null, dedupKey, now, now],
    );
    addLeadActivity(id, actor.userId, "created", `Lead created manually by ${actor.label}.${input.note ? ` Note: ${input.note}` : ""}`);
    recordAudit(actor, "lead", id, "created", undefined, { source: "manual" });
  });
  return get<LeadRow>("SELECT * FROM leads WHERE id = ?", [id])!;
}

export function updateLead(
  actor: AuditActor,
  id: string,
  patch: { stage?: LeadStage; assignedTo?: string | null; nextFollowUpAt?: string | null; lostReason?: string | null; note?: string | null },
): LeadRow {
  const lead = get<LeadRow>("SELECT * FROM leads WHERE id = ?", [id]);
  if (!lead) throw new LeadError("Lead not found", "not_found");
  return tx(() => {
    const now = nowIso();
    if (patch.stage && patch.stage !== lead.stage) {
      if (!canTransitionLead(lead.stage, patch.stage)) {
        throw new LeadError(`A lead can't move from “${lead.stage}” to “${patch.stage}”`, "invalid_transition");
      }
      if (patch.stage === "lost" && !patch.lostReason) throw new LeadError("Please give a reason when marking a lead as lost", "invalid_transition");
      try {
        run("UPDATE leads SET stage = ?, lost_reason = ?, updated_at = ? WHERE id = ?", [patch.stage, patch.stage === "lost" ? patch.lostReason ?? null : null, now, id]);
      } catch {
        throw new LeadError("Another open lead already exists for this opportunity", "duplicate");
      }
      addLeadActivity(id, actor.userId, "stage_changed", `${actor.label} moved the lead from ${lead.stage} to ${patch.stage}${patch.lostReason ? ` (${patch.lostReason})` : ""}`);
      recordAudit(actor, "lead", id, "stage_changed", { stage: lead.stage }, { stage: patch.stage });
    }
    if (patch.assignedTo !== undefined && patch.assignedTo !== lead.assigned_to) {
      run("UPDATE leads SET assigned_to = ?, updated_at = ? WHERE id = ?", [patch.assignedTo, now, id]);
      const name = patch.assignedTo ? get<{ name: string }>("SELECT name FROM users WHERE id = ?", [patch.assignedTo])?.name ?? "someone" : "nobody";
      addLeadActivity(id, actor.userId, "assigned", `${actor.label} assigned the lead to ${name}`);
      recordAudit(actor, "lead", id, "assigned", { assignedTo: lead.assigned_to }, { assignedTo: patch.assignedTo });
    }
    if (patch.nextFollowUpAt !== undefined) {
      run("UPDATE leads SET next_follow_up_at = ?, updated_at = ? WHERE id = ?", [patch.nextFollowUpAt, now, id]);
    }
    if (patch.note) {
      addLeadActivity(id, actor.userId, "note", patch.note);
      run("UPDATE leads SET updated_at = ? WHERE id = ?", [now, id]);
    }
    return get<LeadRow>("SELECT * FROM leads WHERE id = ?", [id])!;
  });
}

export interface LeadActivity {
  id: string;
  type: string;
  body: string;
  actor_name: string | null;
  meta: unknown;
  created_at: string;
}

export function listLeadActivities(leadId: string): LeadActivity[] {
  return all<{ id: string; type: string; body: string; actor_name: string | null; meta_json: string | null; created_at: string }>(
    `SELECT a.id, a.type, a.body, u.name AS actor_name, a.meta_json, a.created_at FROM lead_activities a
     LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.lead_id = ? ORDER BY a.created_at DESC LIMIT 100`,
    [leadId],
  ).map((r) => ({ ...r, meta: parseJson(r.meta_json, null) }));
}

export interface FollowUp {
  id: string;
  lead_id: string;
  due_at: string;
  channel: "call" | "email" | "whatsapp" | "meeting";
  note: string | null;
  status: "pending" | "done" | "cancelled";
  completed_at: string | null;
  created_at: string;
}

export function listFollowUps(leadId: string): FollowUp[] {
  return all<FollowUp>("SELECT * FROM follow_ups WHERE lead_id = ? ORDER BY status = 'pending' DESC, due_at ASC", [leadId]);
}

export function addFollowUp(actor: AuditActor, leadId: string, input: { dueAt: string; channel: FollowUp["channel"]; note?: string | null }): FollowUp {
  const id = newId("fu");
  tx(() => {
    run(
      "INSERT INTO follow_ups (id, lead_id, due_at, channel, note, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
      [id, leadId, input.dueAt, input.channel, input.note ?? null, actor.userId, nowIso()],
    );
    syncNextFollowUp(leadId);
    addLeadActivity(leadId, actor.userId, "follow_up_scheduled", `${actor.label} scheduled a ${input.channel} follow-up for ${input.dueAt.slice(0, 16).replace("T", " ")}`);
  });
  return get<FollowUp>("SELECT * FROM follow_ups WHERE id = ?", [id])!;
}

export function updateFollowUp(actor: AuditActor, leadId: string, followUpId: string, status: "done" | "cancelled"): FollowUp | undefined {
  const fu = get<FollowUp>("SELECT * FROM follow_ups WHERE id = ? AND lead_id = ?", [followUpId, leadId]);
  if (!fu) return undefined;
  tx(() => {
    run("UPDATE follow_ups SET status = ?, completed_at = ? WHERE id = ?", [status, status === "done" ? nowIso() : null, followUpId]);
    syncNextFollowUp(leadId);
    addLeadActivity(leadId, actor.userId, status === "done" ? "follow_up_completed" : "follow_up_cancelled", `${actor.label} marked the ${fu.channel} follow-up as ${status}`);
  });
  return get<FollowUp>("SELECT * FROM follow_ups WHERE id = ?", [followUpId]);
}

function syncNextFollowUp(leadId: string) {
  const next = get<{ due_at: string }>("SELECT due_at FROM follow_ups WHERE lead_id = ? AND status = 'pending' ORDER BY due_at ASC LIMIT 1", [leadId]);
  run("UPDATE leads SET next_follow_up_at = ?, updated_at = ? WHERE id = ?", [next?.due_at ?? null, nowIso(), leadId]);
}

export function leadForTrip(tripId: string): LeadRow | undefined {
  return get<LeadRow>("SELECT * FROM leads WHERE trip_id = ? ORDER BY created_at DESC LIMIT 1", [tripId]);
}

export function leadPreferencesSummary(lead: LeadRow): string | null {
  if (!lead.trip_id) return null;
  const prefs = getPreferences(lead.trip_id);
  return prefs ? summarizeProfile(prefs.profile, prefs.status) : null;
}
