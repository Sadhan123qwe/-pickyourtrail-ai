import { NextResponse } from "next/server";
import { z } from "zod";
import { conflict, parseBody, route } from "@/lib/http";
import { SESSION_COOKIE, SESSION_MAX_AGE, claimAnonymousRecords, cookieOptions, createSession } from "@/lib/auth/session";
import { createUser, findUserByEmail } from "@/lib/repos/users";

const SignupSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(80),
  email: z.email("Please enter a valid email").max(120),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  phone: z.string().trim().max(20).optional(),
});

/** Public sign-up always creates a customer account; employee roles are provisioned by admins. */
export const POST = route({ rateLimit: "auth" }, async ({ req, actor }) => {
  const body = await parseBody(req, SignupSchema);
  if (findUserByEmail(body.email)) throw conflict("An account with this email already exists");
  const user = createUser({ ...body, role: "customer" });
  claimAnonymousRecords(actor.anonId, user.id);
  const res = NextResponse.json({ user }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, createSession(user.id), cookieOptions(SESSION_MAX_AGE));
  return res;
});
