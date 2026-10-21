import "server-only";
import { all, newId, nowIso, run } from "@/lib/db";

export interface AuditActor {
  userId: string | null;
  label: string;
}

export function systemActor(label = "System"): AuditActor {
  return { userId: null, label };
}

export function recordAudit(
  actor: AuditActor,
  entityType: string,
  entityId: string,
  action: string,
  before?: unknown,
  after?: unknown,
) {
  run(
    `INSERT INTO audit_events (id, actor_user_id, actor_label, entity_type, entity_id, action, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId("aud"),
      actor.userId,
      actor.label,
      entityType,
      entityId,
      action,
      before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after),
      nowIso(),
    ],
  );
}

export interface AuditEvent {
  id: string;
  actor_label: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

export function listAudit(filter: { entityType?: string; entityId?: string; limit?: number }): AuditEvent[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.entityType) {
    where.push("entity_type = ?");
    params.push(filter.entityType);
  }
  if (filter.entityId) {
    where.push("entity_id = ?");
    params.push(filter.entityId);
  }
  return all<AuditEvent>(
    `SELECT id, actor_label, entity_type, entity_id, action, before_json, after_json, created_at FROM audit_events
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ${Math.min(filter.limit ?? 50, 200)}`,
    params,
  );
}
