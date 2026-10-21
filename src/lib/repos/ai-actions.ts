import "server-only";
import { all, get, newId, nowIso, parseJson, run } from "@/lib/db";

export type AiActionStatus = "completed" | "proposed" | "rejected" | "failed" | "expired";

export interface RecordRef {
  type: "lead" | "trip" | "ticket" | "customer" | "handoff" | "document" | "itinerary" | "metric" | "follow_up";
  id: string;
  label: string;
  href?: string;
}

export interface AiActionRow {
  id: string;
  source: "command_center" | "planner" | "support";
  conversation_id: string | null;
  actor_user_id: string | null;
  actor_key: string;
  tool: string;
  kind: "read" | "write";
  args_json: string;
  status: AiActionStatus;
  summary: string | null;
  records_json: string | null;
  result_json: string | null;
  error: string | null;
  requires_confirmation: number;
  decided_by: string | null;
  decided_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface AiAction {
  id: string;
  source: AiActionRow["source"];
  conversationId: string | null;
  actorUserId: string | null;
  actorName?: string | null;
  tool: string;
  kind: "read" | "write";
  args: Record<string, unknown>;
  status: AiActionStatus;
  summary: string | null;
  records: RecordRef[];
  result: unknown;
  error: string | null;
  requiresConfirmation: boolean;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

function map(r: AiActionRow & { actor_name?: string | null }): AiAction {
  return {
    id: r.id,
    source: r.source,
    conversationId: r.conversation_id,
    actorUserId: r.actor_user_id,
    actorName: r.actor_name,
    tool: r.tool,
    kind: r.kind,
    args: parseJson(r.args_json, {}),
    status: r.status === "proposed" && r.expires_at && r.expires_at < nowIso() ? "expired" : r.status,
    summary: r.summary,
    records: parseJson(r.records_json, []),
    result: parseJson(r.result_json, null),
    error: r.error,
    requiresConfirmation: !!r.requires_confirmation,
    decidedAt: r.decided_at,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

export function insertAiAction(a: {
  source: AiActionRow["source"];
  conversationId: string | null;
  actorUserId: string | null;
  actorKey: string;
  tool: string;
  kind: "read" | "write";
  args: unknown;
  status: AiActionStatus;
  summary?: string | null;
  records?: RecordRef[];
  result?: unknown;
  error?: string | null;
  requiresConfirmation?: boolean;
  expiresAt?: string | null;
}): AiAction {
  const id = newId("act");
  run(
    `INSERT INTO ai_actions (id, source, conversation_id, actor_user_id, actor_key, tool, kind, args_json, status, summary, records_json,
       result_json, error, requires_confirmation, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, a.source, a.conversationId, a.actorUserId, a.actorKey, a.tool, a.kind, JSON.stringify(a.args ?? {}), a.status, a.summary ?? null,
      JSON.stringify(a.records ?? []), a.result === undefined ? null : JSON.stringify(a.result), a.error ?? null, a.requiresConfirmation ? 1 : 0,
      a.expiresAt ?? null, nowIso(),
    ],
  );
  return getAiAction(id)!;
}

export function getAiAction(id: string): AiAction | undefined {
  const r = get<AiActionRow & { actor_name: string | null }>(
    "SELECT a.*, u.name AS actor_name FROM ai_actions a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.id = ?",
    [id],
  );
  return r ? map(r) : undefined;
}

export function resolveAiAction(id: string, patch: { status: AiActionStatus; decidedBy: string | null; summary?: string; records?: RecordRef[]; result?: unknown; error?: string | null }) {
  run(
    `UPDATE ai_actions SET status = ?, decided_by = ?, decided_at = ?, summary = COALESCE(?, summary), records_json = COALESCE(?, records_json),
       result_json = COALESCE(?, result_json), error = ? WHERE id = ?`,
    [
      patch.status, patch.decidedBy, nowIso(), patch.summary ?? null, patch.records ? JSON.stringify(patch.records) : null,
      patch.result === undefined ? null : JSON.stringify(patch.result), patch.error ?? null, id,
    ],
  );
  return getAiAction(id)!;
}

export function listAiActions(f: { status?: AiActionStatus | "pending"; actorUserId?: string; kind?: "read" | "write"; limit?: number; conversationId?: string }): AiAction[] {
  const where: string[] = [];
  const params: string[] = [];
  if (f.status === "pending") {
    where.push("a.status = 'proposed' AND (a.expires_at IS NULL OR a.expires_at >= ?)");
    params.push(nowIso());
  } else if (f.status) {
    where.push("a.status = ?");
    params.push(f.status);
  }
  if (f.actorUserId) {
    where.push("a.actor_user_id = ?");
    params.push(f.actorUserId);
  }
  if (f.kind) {
    where.push("a.kind = ?");
    params.push(f.kind);
  }
  if (f.conversationId) {
    where.push("a.conversation_id = ?");
    params.push(f.conversationId);
  }
  return all<AiActionRow & { actor_name: string | null }>(
    `SELECT a.*, u.name AS actor_name FROM ai_actions a LEFT JOIN users u ON u.id = a.actor_user_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.created_at DESC LIMIT ${Math.min(f.limit ?? 30, 100)}`,
    params,
  ).map(map);
}
