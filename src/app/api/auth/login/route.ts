import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/http";
import { SESSION_COOKIE, SESSION_MAX_AGE, claimAnonymousRecords, cookieOptions, createSession, deleteSession } from "@/lib/auth/session";
import { authenticate } from "@/lib/repos/users";

const LoginSchema = z.object({
  email: z.email().max(120),
  password: z.string().min(1).max(200),
});

export const POST = route({ rateLimit: "auth" }, async ({ req, actor }) => {
  const body = await parseBody(req, LoginSchema);
  const user = authenticate(body.email, body.password);
  if (!user) throw new ApiError(401, "invalid_credentials", "Incorrect email or password");
  deleteSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user.role === "customer") claimAnonymousRecords(actor.anonId, user.id);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, createSession(user.id), cookieOptions(SESSION_MAX_AGE));
  return res;
});
