import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { SESSION_COOKIE, cookieOptions, deleteSession } from "@/lib/auth/session";

export const POST = route({}, ({ req }) => {
  deleteSession(req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
});
