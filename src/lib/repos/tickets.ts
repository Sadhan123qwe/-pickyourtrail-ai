import "server-only";
import { all, get, newId, nowIso, parseJson, run, tx } from "@/lib/db";
import type { ActorIdentity } from "@/lib/auth/permissions";
import { canTransitionTicket, type TicketCategory, type TicketPriority, type TicketStatus } from "@/lib/workflows/rules";
import { recordAudit, type AuditActor } from "./audit";

export interface TicketRow {
  id: string;
  ref: string;
  user_id: string | null;
  anon_id: string | null;
  trip_id: string | null;
  conversation_id: string | null;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to: string | null;
  escalated: number;
  escalation_reason: string | null;
  contact_email: string | null;
  csat_score: number | null;
  first_response_at: string | null;
  resolved_at: string | null;
  idempotency_key: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface TicketListItem extends TicketRow {
  customer_name: string | null;
  assignee_name: string | null;
  trip_title: string | null;
  message_count: number;
}

export interface TicketMessage {
  id: string;
  author_type: "customer" | "agent" | "ai" | "system";
  author_name: string | null;
  body: string;
  internal: boolean;
  sources: { id: string; title: string }[] | null;
  created_at: string;
}

export class TicketError extends Error {
  constructor(message: string, readonly code: "invalid_transition" | "not_found") {
    super(message);
  }
}

const LIST_SELECT = `
  SELECT t.*, cu.name AS customer_name, au.name AS assignee_name, tr.title AS trip_title,
    (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id AND m.internal = 0) AS message_count
  FROM support_tickets t
  LEFT JOIN users cu ON cu.id = t.user_id
  LEFT JOIN users au ON au.id = t.assigned_to
  LEFT JOIN trips tr ON tr.id = t.trip_id`;

function nextRef(): string {
  const max = get<{ n: number | null }>("SELECT MAX(CAST(SUBSTR(ref, 5) AS INTEGER)) n FROM support_tickets")?.n ?? 1000;
  return `PYT-${max + 1}`;
}

export function getTicket(id: string): TicketListItem | undefined {
  return get<TicketListItem>(`${LIST_SELECT} WHERE t.id = ?`, [id]);
}

function pickSupportAgent(): string | null {
  return (
    get<{ id: string }>(
      `SELECT u.id FROM users u LEFT JOIN support_tickets t ON t.assigned_to = u.id AND t.status NOT IN ('resolved','closed')
       WHERE u.role = 'support' GROUP BY u.id ORDER BY COUNT(t.id) ASC, u.name ASC LIMIT 1`,
    )?.id ?? null
  );
}

/** Creates a ticket. A repeated idempotency key returns the original ticket. */
export function createTicket(args: {
  owner: ActorIdentity;
  subject: string;
  body: string;
  category: TicketCategory;
  priority: TicketPriority;
  escalate: boolean;
  escalationReason: string | null;
  tripId: string | null;
  conversationId: string | null;
  contactEmail: string | null;
  idempotencyKey: string | null;
  transcript?: { author: "customer" | "ai"; body: string }[];
}): { ticket: TicketListItem; duplicate: boolean } {
  if (args.idempotencyKey) {
    const existing = get<{ id: string }>("SELECT id FROM support_tickets WHERE idempotency_key = ?", [args.idempotencyKey]);
    if (existing) return { ticket: getTicket(existing.id)!, duplicate: true };
  }
  const id = newId("tkt");
  const now = nowIso();
  tx(() => {
    const assignee = args.escalate || args.priority === "urgent" || args.priority === "high" ? pickSupportAgent() : null;
    run(
      `INSERT INTO support_tickets (id, ref, user_id, anon_id, trip_id, conversation_id, subject, category, priority, status, assigned_to,
         escalated, escalation_reason, contact_email, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, nextRef(), args.owner.userId, args.owner.anonId, args.tripId, args.conversationId, args.subject.slice(0, 160), args.category,
        args.priority, args.escalate ? "escalated" : "open", assignee, args.escalate ? 1 : 0, args.escalationReason, args.contactEmail,
        args.idempotencyKey, now, now,
      ],
    );
    for (const m of args.transcript ?? []) {
      run("INSERT INTO support_messages (id, ticket_id, author_type, body, internal, created_at) VALUES (?, ?, ?, ?, 0, ?)", [
        newId("smsg"), id, m.author, m.body.slice(0, 4000), now,
      ]);
    }
    run("INSERT INTO support_messages (id, ticket_id, author_type, author_user_id, body, internal, created_at) VALUES (?, ?, 'customer', ?, ?, 0, ?)", [
      newId("smsg"), id, args.owner.userId, args.body.slice(0, 4000), now,
    ]);
    if (args.escalate) {
      run("INSERT INTO support_messages (id, ticket_id, author_type, body, internal, created_at) VALUES (?, ?, 'system', ?, 0, ?)", [
        newId("smsg"), id, `Escalated to a human agent: ${args.escalationReason ?? "needs review"}.`, now,
      ]);
    }
    recordAudit({ userId: args.owner.userId, label: args.owner.userId ? "Customer" : "Anonymous customer" }, "ticket", id, "created", undefined, {
      priority: args.priority, category: args.category, escalated: args.escalate,
    });
  });
  return { ticket: getTicket(id)!, duplicate: false };
}

export function listTicketsForOwner(owner: ActorIdentity): TicketListItem[] {
  return owner.userId
    ? all<TicketListItem>(`${LIST_SELECT} WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 100`, [owner.userId])
    : all<TicketListItem>(`${LIST_SELECT} WHERE t.user_id IS NULL AND t.anon_id = ? ORDER BY t.updated_at DESC LIMIT 100`, [owner.anonId]);
}

export interface TicketFilter {
  q?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignedTo?: string;
  escalated?: boolean;
  sort?: "updated_desc" | "priority_desc" | "created_asc";
  limit: number;
  offset: number;
}

export function listTickets(f: TicketFilter): { items: TicketListItem[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q) {
    where.push("(t.subject LIKE ? OR t.ref LIKE ? OR cu.name LIKE ? OR t.contact_email LIKE ?)");
    params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
  }
  if (f.status === "active") where.push("t.status NOT IN ('resolved','closed')");
  else if (f.status) {
    where.push("t.status = ?");
    params.push(f.status);
  }
  for (const [col, val] of [["t.priority", f.priority], ["t.category", f.category]] as const) {
    if (val) {
      where.push(`${col} = ?`);
      params.push(val);
    }
  }
  if (f.assignedTo) {
    where.push(f.assignedTo === "unassigned" ? "t.assigned_to IS NULL" : "t.assigned_to = ?");
    if (f.assignedTo !== "unassigned") params.push(f.assignedTo);
  }
  if (f.escalated) where.push("t.escalated = 1");
  const order = {
    updated_desc: "t.updated_at DESC",
    priority_desc: "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at ASC",
    created_asc: "t.created_at ASC",
  }[f.sort ?? "priority_desc"];
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = get<{ c: number }>(`SELECT COUNT(*) c FROM support_tickets t LEFT JOIN users cu ON cu.id = t.user_id ${whereSql}`, params)?.c ?? 0;
  const items = all<TicketListItem>(`${LIST_SELECT} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, f.limit, f.offset]);
  return { items, total };
}

export function listTicketMessages(ticketId: string, includeInternal: boolean): TicketMessage[] {
  return all<{ id: string; author_type: TicketMessage["author_type"]; author_name: string | null; body: string; internal: number; sources_json: string | null; created_at: string }>(
    `SELECT m.id, m.author_type, u.name AS author_name, m.body, m.internal, m.sources_json, m.created_at
     FROM support_messages m LEFT JOIN users u ON u.id = m.author_user_id
     WHERE m.ticket_id = ? ${includeInternal ? "" : "AND m.internal = 0"} ORDER BY m.created_at ASC, m.rowid ASC`,
    [ticketId],
  ).map((r) => ({ ...r, internal: !!r.internal, sources: parseJson(r.sources_json, null) }));
}

export function addTicketMessage(args: {
  ticket: TicketRow;
  authorType: TicketMessage["author_type"];
  authorUserId: string | null;
  body: string;
  internal?: boolean;
  sources?: { id: string; title: string }[];
}): TicketMessage[] {
  const now = nowIso();
  tx(() => {
    run(
      "INSERT INTO support_messages (id, ticket_id, author_type, author_user_id, body, internal, sources_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [newId("smsg"), args.ticket.id, args.authorType, args.authorUserId, args.body.slice(0, 4000), args.internal ? 1 : 0, args.sources ? JSON.stringify(args.sources) : null, now],
    );
    if (args.authorType === "agent" && !args.internal) {
      // First human response time is a key support metric.
      run("UPDATE support_tickets SET first_response_at = COALESCE(first_response_at, ?) WHERE id = ?", [now, args.ticket.id]);
      if (args.ticket.status === "open") run("UPDATE support_tickets SET status = 'in_progress' WHERE id = ?", [args.ticket.id]);
    }
    if (args.authorType === "customer" && (args.ticket.status === "pending_customer" || args.ticket.status === "resolved")) {
      run("UPDATE support_tickets SET status = 'in_progress', resolved_at = NULL WHERE id = ?", [args.ticket.id]);
    }
    run("UPDATE support_tickets SET updated_at = ? WHERE id = ?", [now, args.ticket.id]);
  });
  return listTicketMessages(args.ticket.id, args.authorType === "agent");
}

export function updateTicket(
  actor: AuditActor,
  id: string,
  patch: { status?: TicketStatus; assignedTo?: string | null; priority?: TicketPriority; escalate?: boolean; escalationReason?: string | null; csatScore?: number },
): TicketListItem {
  const ticket = get<TicketRow>("SELECT * FROM support_tickets WHERE id = ?", [id]);
  if (!ticket) throw new TicketError("Ticket not found", "not_found");
  return tx(() => {
    const now = nowIso();
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    let status = patch.status;
    if (patch.escalate && ticket.status !== "escalated") status = "escalated";
    if (status && status !== ticket.status) {
      if (!canTransitionTicket(ticket.status, status)) {
        throw new TicketError(`A ticket can't move from “${ticket.status}” to “${status}”`, "invalid_transition");
      }
      run(
        `UPDATE support_tickets SET status = ?, resolved_at = CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at, ?) ELSE NULL END,
           escalated = CASE WHEN ? = 'escalated' THEN 1 ELSE escalated END, escalation_reason = CASE WHEN ? = 'escalated' THEN ? ELSE escalation_reason END
         WHERE id = ?`,
        [status, status, now, status, status, patch.escalationReason ?? ticket.escalation_reason ?? "Escalated by agent", id],
      );
      before.status = ticket.status;
      after.status = status;
      run("INSERT INTO support_messages (id, ticket_id, author_type, body, internal, created_at) VALUES (?, ?, 'system', ?, 0, ?)", [
        newId("smsg"), id, `Status changed to ${status.replace("_", " ")} by ${actor.label}.`, now,
      ]);
    }
    if (patch.assignedTo !== undefined && patch.assignedTo !== ticket.assigned_to) {
      run("UPDATE support_tickets SET assigned_to = ? WHERE id = ?", [patch.assignedTo, id]);
      before.assignedTo = ticket.assigned_to;
      after.assignedTo = patch.assignedTo;
    }
    if (patch.priority && patch.priority !== ticket.priority) {
      run("UPDATE support_tickets SET priority = ? WHERE id = ?", [patch.priority, id]);
      before.priority = ticket.priority;
      after.priority = patch.priority;
    }
    if (patch.csatScore !== undefined) {
      run("UPDATE support_tickets SET csat_score = ? WHERE id = ?", [patch.csatScore, id]);
      after.csatScore = patch.csatScore;
    }
    run("UPDATE support_tickets SET updated_at = ? WHERE id = ?", [now, id]);
    if (Object.keys(after).length) recordAudit(actor, "ticket", id, "updated", before, after);
    return getTicket(id)!;
  });
}
