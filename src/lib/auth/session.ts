import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { get, newId, nowIso, run } from "@/lib/db";
import { isProduction } from "@/lib/config";
import type { Role } from "./permissions";

export const SESSION_COOKIE = "pyt_session";
export const ANON_COOKIE = "pyt_anon";
const SESSION_DAYS = 7;

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction() && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600;
export const ANON_MAX_AGE = 180 * 24 * 3600;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session and returns the opaque token for the cookie. Only its hash is stored. */
export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  run("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", [hashToken(token), userId, expires, nowIso()]);
  return token;
}

export function userFromSessionToken(token: string | undefined | null): SafeUser | null {
  if (!token || token.length > 200) return null;
  const row = get<SafeUser & { expires_at: string }>(
    `SELECT u.id, u.email, u.name, u.role, u.phone, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    [hashToken(token)],
  );
  if (!row) return null;
  if (row.expires_at < nowIso()) {
    run("DELETE FROM sessions WHERE id = ?", [hashToken(token)]);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role, phone: row.phone };
}

export function deleteSession(token: string | undefined | null) {
  if (token) run("DELETE FROM sessions WHERE id = ?", [hashToken(token)]);
}

const ANON_RE = /^anon_[A-Za-z0-9_-]{12,40}$/;

export function isValidAnonId(value: string | undefined | null): value is string {
  return !!value && ANON_RE.test(value);
}

export function newAnonId(): string {
  return newId("anon");
}

/** Moves anonymous trips, conversations, tickets and leads to a newly signed-in account. */
export function claimAnonymousRecords(anonId: string, userId: string) {
  for (const table of ["trips", "conversations", "support_tickets", "leads"]) {
    run(`UPDATE ${table} SET user_id = ? WHERE anon_id = ? AND user_id IS NULL`, [userId, anonId]);
  }
}
