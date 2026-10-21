import "server-only";
import { all, get, newId, nowIso, parseJson, run } from "@/lib/db";
import type { ActorIdentity } from "@/lib/auth/permissions";

export type ConversationKind = "planner" | "support" | "copilot";

export interface ConversationRow {
  id: string;
  kind: ConversationKind;
  trip_id: string | null;
  user_id: string | null;
  anon_id: string | null;
  summary: string | null;
  status: "active" | "closed";
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  role: "user" | "assistant" | "agent" | "system";
  content: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export function createConversation(owner: ActorIdentity, kind: ConversationKind, tripId: string | null = null): ConversationRow {
  const id = newId("conv");
  const now = nowIso();
  run(
    `INSERT INTO conversations (id, kind, trip_id, user_id, anon_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    [id, kind, tripId, owner.userId, owner.anonId, now, now],
  );
  return getConversation(id)!;
}

export function getConversation(id: string): ConversationRow | undefined {
  return get<ConversationRow>("SELECT * FROM conversations WHERE id = ?", [id]);
}

export function findConversationForTrip(tripId: string, kind: ConversationKind): ConversationRow | undefined {
  return get<ConversationRow>("SELECT * FROM conversations WHERE trip_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1", [tripId, kind]);
}

export function latestConversationForOwner(owner: ActorIdentity, kind: ConversationKind): ConversationRow | undefined {
  return owner.userId
    ? get<ConversationRow>("SELECT * FROM conversations WHERE user_id = ? AND kind = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1", [owner.userId, kind])
    : get<ConversationRow>(
        "SELECT * FROM conversations WHERE user_id IS NULL AND anon_id = ? AND kind = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
        [owner.anonId, kind],
      );
}

/** Adds a message. A repeated `clientMessageId` returns the existing message (idempotent retries). */
export function addMessage(
  conversationId: string,
  role: MessageRecord["role"],
  content: string,
  meta: Record<string, unknown> | null = null,
  clientMessageId: string | null = null,
): { message: MessageRecord; duplicate: boolean } {
  if (clientMessageId) {
    const existing = get<{ id: string }>(
      "SELECT id FROM conversation_messages WHERE conversation_id = ? AND client_message_id = ?",
      [conversationId, clientMessageId],
    );
    if (existing) return { message: getMessage(existing.id)!, duplicate: true };
  }
  const id = newId("msg");
  const now = nowIso();
  run(
    `INSERT INTO conversation_messages (id, conversation_id, role, content, meta_json, client_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, conversationId, role, content, meta ? JSON.stringify(meta) : null, clientMessageId, now],
  );
  run("UPDATE conversations SET updated_at = ? WHERE id = ?", [now, conversationId]);
  // Build the record from what we just wrote instead of reading it back.
  return { message: { id, role, content, meta, createdAt: now }, duplicate: false };
}

function getMessage(id: string): MessageRecord | undefined {
  const row = get<{ id: string; role: MessageRecord["role"]; content: string; meta_json: string | null; created_at: string }>(
    "SELECT id, role, content, meta_json, created_at FROM conversation_messages WHERE id = ?",
    [id],
  );
  return row ? { id: row.id, role: row.role, content: row.content, meta: parseJson(row.meta_json, null), createdAt: row.created_at } : undefined;
}

/** Returns the reply that followed a given user message (for idempotent retries). */
export function replyAfter(conversationId: string, messageId: string): MessageRecord | undefined {
  const row = get<{ id: string }>(
    `SELECT id FROM conversation_messages WHERE conversation_id = ? AND role = 'assistant'
       AND created_at >= (SELECT created_at FROM conversation_messages WHERE id = ?) AND id <> ?
     ORDER BY created_at ASC LIMIT 1`,
    [conversationId, messageId, messageId],
  );
  return row ? getMessage(row.id) : undefined;
}

export function listMessages(conversationId: string, limit = 200, offset = 0): MessageRecord[] {
  return all<{ id: string; role: MessageRecord["role"]; content: string; meta_json: string | null; created_at: string }>(
    "SELECT id, role, content, meta_json, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ? OFFSET ?",
    [conversationId, limit, offset],
  ).map((row) => ({ id: row.id, role: row.role, content: row.content, meta: parseJson(row.meta_json, null), createdAt: row.created_at }));
}

export function updateConversationSummary(id: string, summary: string) {
  run("UPDATE conversations SET summary = ?, updated_at = ? WHERE id = ?", [summary.slice(0, 2000), nowIso(), id]);
}
