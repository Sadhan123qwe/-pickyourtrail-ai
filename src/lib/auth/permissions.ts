/**
 * Role-based access control. Checked on the server for every protected
 * operation; the UI uses the same table only to hide unavailable actions.
 */

export const ROLES = ["customer", "sales", "support", "ops", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "leads:read",
  "leads:write",
  "tickets:read",
  "tickets:write",
  "trips:read_all",
  "trips:write_ops",
  "dashboard:read",
  "analytics:read",
  "copilot:use",
  "knowledge:read_internal",
  "users:list",
  "settings:manage",
  "audit:read",
  "knowledge:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<Role, readonly Permission[]> = {
  customer: [],
  sales: ["leads:read", "leads:write", "trips:read_all", "dashboard:read", "analytics:read", "copilot:use", "knowledge:read_internal", "users:list"],
  support: ["tickets:read", "tickets:write", "trips:read_all", "dashboard:read", "copilot:use", "knowledge:read_internal", "users:list"],
  ops: ["trips:read_all", "trips:write_ops", "tickets:read", "dashboard:read", "analytics:read", "copilot:use", "knowledge:read_internal", "users:list", "audit:read"],
  admin: PERMISSIONS,
};

export const ROLE_LABELS: Record<Role, string> = {
  customer: "Customer",
  sales: "Sales",
  support: "Support",
  ops: "Operations",
  admin: "Admin",
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role].includes(permission);
}

export function isEmployee(role: Role | null | undefined): boolean {
  return !!role && role !== "customer";
}

export interface OwnedRecord {
  user_id: string | null;
  anon_id: string | null;
}

export interface ActorIdentity {
  userId: string | null;
  role: Role | null;
  anonId: string;
}

/**
 * A customer may access a record they own: by account, or, for records not yet
 * claimed by an account, by the anonymous session that created it.
 */
export function ownsRecord(actor: ActorIdentity, record: OwnedRecord): boolean {
  if (record.user_id) return actor.userId === record.user_id;
  return !!record.anon_id && record.anon_id === actor.anonId;
}

export function canAccessTrip(actor: ActorIdentity, trip: OwnedRecord): boolean {
  return ownsRecord(actor, trip) || can(actor.role, "trips:read_all");
}

export function canAccessTicket(actor: ActorIdentity, ticket: OwnedRecord): boolean {
  return ownsRecord(actor, ticket) || can(actor.role, "tickets:read");
}
