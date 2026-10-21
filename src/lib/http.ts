import "server-only";
import { currentRequestMetrics, recordRequest, routeKey, runWithRequestMetrics } from "@/lib/metrics";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { can, type ActorIdentity, type Permission } from "@/lib/auth/permissions";
import {
  ANON_COOKIE,
  ANON_MAX_AGE,
  SESSION_COOKIE,
  cookieOptions,
  isValidAnonId,
  newAnonId,
  userFromSessionToken,
  type SafeUser,
} from "@/lib/auth/session";
import { checkRateLimit, type RateBucket } from "@/lib/rate-limit";

/** Consistent error format: `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "bad_request", message, details);
export const unauthorized = (message = "Please sign in to continue") => new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You don't have permission to do that") => new ApiError(403, "forbidden", message);
export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);

export interface Actor extends ActorIdentity {
  user: SafeUser | null;
  /** Stable key for usage limits and logs: no names or emails. */
  key: string;
  ip: string;
  isNewAnon: boolean;
}

export function resolveActor(req: NextRequest): Actor {
  const user = userFromSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const existingAnon = req.cookies.get(ANON_COOKIE)?.value;
  const isNewAnon = !isValidAnonId(existingAnon);
  const anonId = isNewAnon ? newAnonId() : existingAnon!;
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
  return {
    user,
    userId: user?.id ?? null,
    role: user?.role ?? null,
    anonId,
    key: user ? `user:${user.id}` : `anon:${anonId}`,
    ip,
    isNewAnon,
  };
}

export function requireUser(actor: Actor): SafeUser {
  if (!actor.user) throw unauthorized();
  return actor.user;
}

export function requirePermission(actor: Actor, permission: Permission): SafeUser {
  const user = requireUser(actor);
  if (!can(user.role, permission)) throw forbidden();
  return user;
}

const MAX_BODY_BYTES = 64 * 1024;

export async function parseBody<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Request body is too large");
  let json: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Request body is too large");
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(json);
}

export function parseQuery<T>(req: NextRequest, schema: z.ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

interface RouteOptions {
  rateLimit?: RateBucket;
}

type Handler<P> = (args: { req: NextRequest; actor: Actor; params: P }) => Promise<unknown> | unknown;

/**
 * Wraps a route handler with actor resolution, rate limiting, consistent
 * error responses and anonymous-session cookie management.
 */
export function route<P extends Record<string, string> = Record<string, never>>(options: RouteOptions, handler: Handler<P>) {
  return (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => runWithRequestMetrics(() => handle(req, ctx));
  async function handle(req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> {
    const t0 = performance.now();
    let actor: Actor | null = null;
    let response: Response;
    try {
      actor = resolveActor(req);
      const bucket = options.rateLimit ?? (req.method === "GET" ? "read" : "write");
      const rl = checkRateLimit(bucket, [actor.ip, actor.key]);
      if (!rl.allowed) {
        response = NextResponse.json(
          { error: { code: "rate_limited", message: "Too many requests. Please wait a moment and try again." } },
          { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
        );
      } else {
        const params = ((await ctx?.params) ?? {}) as P;
        const result = await handler({ req, actor, params });
        response = result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
      }
    } catch (error) {
      response = errorResponse(error);
    }
    if (actor?.isNewAnon) {
      const next =
        response instanceof NextResponse ? response : new NextResponse(response.body, { status: response.status, headers: response.headers });
      next.cookies.set(ANON_COOKIE, actor.anonId, cookieOptions(ANON_MAX_AGE));
      response = next;
    }
    response.headers.set("Cache-Control", "no-store");
    // Measured timings (no data): total handler time and database time/queries for this request.
    const ms = performance.now() - t0;
    const m = currentRequestMetrics();
    response.headers.set("Server-Timing", `app;dur=${ms.toFixed(1)}, db;dur=${(m?.dbMs ?? 0).toFixed(1)};desc="${m?.dbCount ?? 0} queries"`);
    recordRequest(routeKey(req.method, req.nextUrl.pathname), ms, response.status, m, response.status === 504);
    return response;
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: "Some fields are invalid",
          details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  console.error("[api] unexpected error", error instanceof Error ? error.message : "unknown");
  return NextResponse.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, { status: 500 });
}

export function paginate(searchParams: URLSearchParams, defaultSize = 20) {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize")) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
