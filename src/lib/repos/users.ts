import "server-only";
import { all, get, newId, nowIso, run } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { Role } from "@/lib/auth/permissions";
import type { SafeUser } from "@/lib/auth/session";

const SAFE_COLUMNS = "id, email, name, role, phone";

export function findUserByEmail(email: string): (SafeUser & { password_hash: string }) | undefined {
  return get(`SELECT ${SAFE_COLUMNS}, password_hash FROM users WHERE email = ?`, [email.trim().toLowerCase()]);
}

export function getUser(id: string): SafeUser | undefined {
  return get(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ?`, [id]);
}

export function createUser(input: { email: string; name: string; password: string; role?: Role; phone?: string | null }): SafeUser {
  const id = newId("usr");
  const now = nowIso();
  run(
    "INSERT INTO users (id, email, name, role, password_hash, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, input.email.trim().toLowerCase(), input.name.trim(), input.role ?? "customer", hashPassword(input.password), input.phone ?? null, now, now],
  );
  return getUser(id)!;
}

/** Constant-ish time login check: always runs a hash comparison. */
export function authenticate(email: string, password: string): SafeUser | null {
  const user = findUserByEmail(email);
  const ok = verifyPassword(password, user?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!user || !ok) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone };
}

export function listEmployees(role?: Role): SafeUser[] {
  return role
    ? all(`SELECT ${SAFE_COLUMNS} FROM users WHERE role = ? ORDER BY name`, [role])
    : all(`SELECT ${SAFE_COLUMNS} FROM users WHERE role <> 'customer' ORDER BY name`);
}
