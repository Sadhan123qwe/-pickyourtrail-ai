import { beforeEach, describe, expect, it } from "vitest";
import { TestClient } from "../support/client";
import { resetRateLimits } from "@/lib/rate-limit";
import { closeDb, get } from "@/lib/db";
import { getPreferences } from "@/lib/repos/trips";
import * as login from "@/app/api/auth/login/route";
import * as signup from "@/app/api/auth/signup/route";
import * as profile from "@/app/api/profile/route";
import * as chat from "@/app/api/ai/chat/route";
import * as start from "@/app/api/trips/preferences/route";
import * as tripById from "@/app/api/trips/[id]/route";
import * as trips from "@/app/api/trips/route";
import * as leads from "@/app/api/leads/route";
import * as leadById from "@/app/api/leads/[id]/route";
import * as tickets from "@/app/api/support/tickets/route";
import * as ticketById from "@/app/api/support/tickets/[id]/route";
import * as handoffById from "@/app/api/bookings/handoff/[id]/route";
import * as handoff from "@/app/api/bookings/handoff/route";
import * as generate from "@/app/api/itineraries/generate/route";
import * as overview from "@/app/api/dashboard/overview/route";
import * as settings from "@/app/api/admin/settings/route";
import * as copilot from "@/app/api/copilot/chat/route";
import * as reports from "@/app/api/analytics/reports/route";
import * as conversation from "@/app/api/ai/conversations/[id]/messages/route";

async function as(email: string) {
  const c = new TestClient();
  const r = await c.call(login.POST, "POST", "/api/auth/login", { email, password: "demo1234" });
  expect(r.status).toBe(200);
  return c;
}

async function plannedTrip(c: TestClient) {
  const s = await c.call(start.POST, "POST", "/api/trips/preferences");
  const tripId = s.body.trip.id as string;
  await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "5 days in Bali in May 2027 for 2 adults, budget 2 lakh total" });
  return { tripId, conversationId: s.body.conversationId as string };
}

beforeEach(() => resetRateLimits());

describe("authentication", () => {
  it("rejects wrong passwords and sets an httpOnly session cookie on success", async () => {
    const c = new TestClient();
    const bad = await c.call(login.POST, "POST", "/api/auth/login", { email: "sales@pyt-demo.test", password: "nope" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("invalid_credentials");
    const ok = await c.call(login.POST, "POST", "/api/auth/login", { email: "sales@pyt-demo.test", password: "demo1234" });
    const cookie = ok.headers.getSetCookie().find((h) => h.startsWith("pyt_session="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(JSON.stringify(ok.body)).not.toMatch(/password|scrypt/);
  });

  it("public sign-up always creates a customer, never an employee", async () => {
    const c = new TestClient();
    const r = await c.call(signup.POST, "POST", "/api/auth/signup", { name: "Eve", email: "eve@example.com", password: "password123", role: "admin" });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe("customer");
    const dup = await new TestClient().call(signup.POST, "POST", "/api/auth/signup", { name: "Eve", email: "EVE@example.com", password: "password123" });
    expect(dup.status).toBe(409);
    const me = await c.call(profile.GET, "GET", "/api/profile");
    expect(me.body.isEmployee).toBe(false);
  });

  it("moves anonymous trips to the account on sign-up", async () => {
    const c = new TestClient();
    const { tripId } = await plannedTrip(c);
    await c.call(signup.POST, "POST", "/api/auth/signup", { name: "Claimer", email: "claimer@example.com", password: "password123" });
    const mine = await c.call(trips.GET, "GET", "/api/trips");
    expect(mine.body.items.map((t: { id: string }) => t.id)).toContain(tripId);
    // The bare anonymous cookie no longer grants access once the trip belongs to an account.
    const anonOnly = new TestClient();
    anonOnly.cookies.set("pyt_anon", c.cookies.get("pyt_anon")!);
    expect((await anonOnly.call(tripById.GET, "GET", "", undefined, { id: tripId })).status).toBe(403);
  });
});

describe("authorization", () => {
  it("blocks unauthenticated access to employee data", async () => {
    const anon = new TestClient();
    for (const [handler, path] of [
      [leads.GET, "/api/leads"],
      [overview.GET, "/api/dashboard/overview"],
      [reports.GET, "/api/analytics/reports"],
      [settings.GET, "/api/admin/settings"],
    ] as const) {
      const r = await anon.call(handler, "GET", path);
      expect(r.status, path).toBe(401);
    }
    expect((await anon.call(tickets.GET, "GET", "/api/support/tickets?scope=all")).status).toBe(401);
    expect((await anon.call(trips.GET, "GET", "/api/trips?scope=all")).status).toBe(401);
    expect((await anon.call(copilot.POST, "POST", "/api/copilot/chat", { message: "hello there" })).status).toBe(401);
  });

  it("stops customers from reading another customer's trip, itinerary or conversation", async () => {
    const alice = new TestClient();
    const { tripId, conversationId } = await plannedTrip(alice);
    const mallory = new TestClient();
    expect((await mallory.call(tripById.GET, "GET", "", undefined, { id: tripId })).status).toBe(403);
    expect((await mallory.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "hijack" })).status).toBe(403);
    expect((await mallory.call(generate.POST, "POST", "/api/itineraries/generate", { tripId })).status).toBe(403);
    expect((await mallory.call(conversation.GET, "GET", "", undefined, { id: conversationId })).status).toBe(403);
    expect((await mallory.call(tripById.PATCH, "PATCH", "", { status: "cancelled" }, { id: tripId })).status).toBe(403);
    const customer = await as("customer@pyt-demo.test");
    expect((await customer.call(tripById.GET, "GET", "", undefined, { id: tripId })).status).toBe(403);
    expect((await customer.call(leads.GET, "GET", "/api/leads")).status).toBe(403);
  });

  it("applies role boundaries between sales, support and ops", async () => {
    const sales = await as("sales@pyt-demo.test");
    const support = await as("support@pyt-demo.test");
    const ops = await as("ops@pyt-demo.test");
    const anyLead = (await sales.call(leads.GET, "GET", "/api/leads")).body.items[0];
    expect((await support.call(leadById.GET, "GET", "", undefined, { id: anyLead.id })).status).toBe(403);
    const anyTicket = (await support.call(tickets.GET, "GET", "/api/support/tickets?scope=all")).body.items[0];
    expect((await sales.call(ticketById.GET, "GET", "", undefined, { id: anyTicket.id })).status).toBe(403);
    expect((await ops.call(ticketById.PATCH, "PATCH", "", { status: "resolved" }, { id: anyTicket.id })).status).toBe(403);
    expect((await sales.call(settings.GET, "GET", "/api/admin/settings")).status).toBe(403);
    // Sales may read trips but not change bookings.
    const anyHandoff = get<{ id: string }>("SELECT id FROM booking_handoffs LIMIT 1")!;
    expect((await sales.call(handoffById.PATCH, "PATCH", "", { opsStatus: "in_review" }, { id: anyHandoff.id })).status).toBe(403);
    // Copilot respects the employee's permissions.
    expect((await support.call(copilot.POST, "POST", "/api/copilot/chat", { message: "summarize", leadId: anyLead.id })).status).toBe(403);
  });

  it("never lets staff fabricate a provider confirmation", async () => {
    const ops = await as("ops@pyt-demo.test");
    const h = get<{ id: string; ops_status: string }>("SELECT id, ops_status FROM booking_handoffs WHERE ops_status = 'pending' LIMIT 1")!;
    const r = await ops.call(handoffById.PATCH, "PATCH", "", { opsStatus: "in_review", providerStatus: "provider_confirmed", providerReference: "FAKE123" }, { id: h.id });
    expect(r.status).toBe(200);
    expect(r.body.handoff.ops_status).toBe("in_review");
    expect(r.body.handoff.provider_status).toBe("not_submitted");
    expect(r.body.handoff.provider_reference).toBeNull();
    const invalid = await ops.call(handoffById.PATCH, "PATCH", "", { opsStatus: "customer_accepted" }, { id: h.id });
    expect(invalid.status).toBe(409);
  });
});

describe("input validation, duplicates and rate limiting", () => {
  it("returns consistent validation errors", async () => {
    const c = new TestClient();
    const r = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", message: "" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("validation_error");
    const bad = await c.call(chat.POST, "POST", "/api/ai/chat", "{not json");
    expect(bad.status).toBe(400);
    const huge = await c.call(tickets.POST, "POST", "/api/support/tickets", { message: "x".repeat(70_000) });
    expect(huge.status).toBe(413);
    const sales = await as("sales@pyt-demo.test");
    const lead = (await sales.call(leads.GET, "GET", "/api/leads?stage=new")).body.items[0];
    const skip = await sales.call(leadById.PATCH, "PATCH", "", { stage: "won" }, { id: lead.id });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe("invalid_transition");
  });

  it("deduplicates retried tickets, handoffs and manual leads", async () => {
    const c = new TestClient();
    const a = await c.call(tickets.POST, "POST", "/api/support/tickets", { message: "Please help with visa documents", idempotencyKey: "same-key-123" });
    const b = await c.call(tickets.POST, "POST", "/api/support/tickets", { message: "Please help with visa documents", idempotencyKey: "same-key-123" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.ticket.id).toBe(a.body.ticket.id);

    const { tripId } = await plannedTrip(c);
    await c.call(generate.POST, "POST", "/api/itineraries/generate", { tripId });
    const body = { tripId, contactName: "Dup Test", contactEmail: "dup@example.com", confirm: true };
    const h1 = await c.call(handoff.POST, "POST", "/api/bookings/handoff", { ...body, idempotencyKey: "handoff-key-1" });
    const h2 = await c.call(handoff.POST, "POST", "/api/bookings/handoff", { ...body, idempotencyKey: "handoff-key-2" });
    expect(h1.status).toBe(201);
    expect(h2.body.duplicate).toBe(true);
    expect(h2.body.handoff.id).toBe(h1.body.handoff.id);

    const sales = await as("sales@pyt-demo.test");
    const lead = { name: "Walk In", email: "walkin@example.com", destination: "Dubai" };
    expect((await sales.call(leads.POST, "POST", "/api/leads", lead)).status).toBe(201);
    expect((await sales.call(leads.POST, "POST", "/api/leads", lead)).status).toBe(409);
  });

  it("creates exactly one lead per planning opportunity", async () => {
    const c = new TestClient();
    const { tripId } = await plannedTrip(c);
    for (const m of ["from Pune", "relaxed", "beaches"]) await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: m });
    expect(get<{ c: number }>("SELECT COUNT(*) c FROM leads WHERE trip_id = ?", [tripId])!.c).toBe(1);
  });

  it("rate limits the AI endpoint", async () => {
    const c = new TestClient();
    const { tripId } = await plannedTrip(c);
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const r = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "relaxed" });
      if (r.status === 429) {
        limited++;
        expect(r.headers.get("retry-after")).toBeTruthy();
      }
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe("persistence", () => {
  it("keeps data after the database connection is closed and reopened (server restart)", async () => {
    const c = new TestClient();
    const { tripId } = await plannedTrip(c);
    const before = getPreferences(tripId)!;
    closeDb();
    const after = getPreferences(tripId)!;
    expect(after.profile).toEqual(before.profile);
    expect((await c.call(tripById.GET, "GET", "", undefined, { id: tripId })).body.profile.destinationId).toBe("bali");
  });
});
