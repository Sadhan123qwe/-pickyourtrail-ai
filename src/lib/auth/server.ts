import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, userFromSessionToken, type SafeUser } from "./session";

/** Current user for server components and layouts (null when signed out). */
export async function getServerUser(): Promise<SafeUser | null> {
  const store = await cookies();
  return userFromSessionToken(store.get(SESSION_COOKIE)?.value);
}
