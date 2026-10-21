import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestClient } from "../support/client";
import { responsesPayload, startFakeOpenAI } from "../support/fake-openai";
import { resetRateLimits } from "@/lib/rate-limit";
import { all, get, run } from "@/lib/db";
import { executeTool } from "@/lib/ai/tools/registry";
import { purgeExpiredData } from "@/lib/services/retention";
import * as login from "@/app/api/auth/login/route";
import * as chat from "@/app/api/ai/chat/route";
import * as start from "@/app/api/trips/preferences/route";
import * as prefsById from "@/app/api/trips/preferences/[id]/route";
import * as generate from "@/app/api/itineraries/generate/route";
import * as voice from "@/app/api/ai/voice/session/route";
import * as performance from "@/app/api/admin/performance/route";
import * as trips from "@/app/api/trips/route";

async function as(email: string) {
  const c = new TestClient();
  expect((await c.call(login.POST, "POST", "/api/auth/login", { email, password: "demo1234" })).status).toBe(200);
  return c;
}
async function newTrip(c: TestClient) {
  return (await c.call(start.POST, "POST", "/api/trips/preferences")).body.trip.id as string;
}
const say = (c: TestClient, tripId: string, message: string) => c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message });

let fake: Awaited<ReturnType<typeof startFakeOpenAI>>;
beforeAll(async () => {
  fake = await startFakeOpenAI(() => ({ json: responsesPayload({}) }));
});
afterAll(() => fake.close());
beforeEach(() => resetRateLimits());
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
});

describe("trip preference provenance", () => {
  it("separates stated, inferred and default values, and records confirmations", async () => {
    const c = new TestClient();
    const tripId = await newTrip(c);
    const r = await say(c, tripId, "Five days in Bali in December for 2 adults and 2 kids, budget 1.5 lakh");
    expect(r.status).toBe(200);
    expect(r.body.profile).toMatchObject({ tripType: "family", budgetScope: "total" });
    expect(r.body.provenance).toMatchObject({ destination: "stated", duration: "stated", travellers: "stated", budget: "stated", tripType: "inferred" });
    // Persisted: the snapshot after a reload returns the same provenance.
    const snap = await c.call(prefsById.GET, "GET", "", undefined, { id: tripId });
    expect(snap.body.provenance.tripType).toBe("inferred");
    // Editing in the Trip Profile confirms the value.
    const edit = await c.call(prefsById.PATCH, "PATCH", "", { updates: { tripType: "family" } }, { id: tripId });
    expect(edit.status).toBe(200);
    const after = await c.call(prefsById.GET, "GET", "", undefined, { id: tripId });
    expect(after.body.provenance.tripType).toBe("confirmed");
  });

  it("summarises the trip from stored data without an AI call or state change", async () => {
    const c = new TestClient();
    const tripId = await newTrip(c);
    await say(c, tripId, "A 6 day trip to Japan in April for 2 adults");
    const usageBefore = get<{ c: number }>("SELECT COUNT(*) c FROM usage_records")!.c;
    const versionBefore = (await c.call(prefsById.GET, "GET", "", undefined, { id: tripId })).body.version;
    const r = await say(c, tripId, "Can you summarize my trip?");
    expect(r.body.turn.reply).toMatch(/Here's your trip so far — .*Japan/);
    expect(get<{ c: number }>("SELECT COUNT(*) c FROM usage_records")!.c).toBe(usageBefore);
    expect(r.body.version).toBe(versionBefore);
  });

  it("asks the customer to confirm a recap before generating", async () => {
    const c = new TestClient();
    const tripId = await newTrip(c);
    await say(c, tripId, "A 5 day trip to Dubai in January for 2 adults, budget 2 lakh total including flights from Mumbai");
    let last;
    for (const m of ["flexible", "couple", "food and culture", "balanced", "midrange", "none", "none", "no"]) {
      last = await say(c, tripId, m);
      if (last.body.turn.question?.key === "review") break;
    }
    expect(last!.body.turn.question?.key).toBe("review");
    expect(last!.body.turn.reply).toMatch(/Here's what I have: Dubai · 5 days/);
    const go = await say(c, tripId, "Yes, generate it");
    expect(go.body.turn.stage).toBe("ready");
    expect(Object.values(go.body.provenance)).toContain("confirmed");
  });
});

describe("voice sessions", () => {
  it("only issues a session for the caller's own trip, and never in mock mode", async () => {
    const owner = await as("customer@pyt-demo.test");
    const other = await as("customer2@pyt-demo.test");
    const tripId = (await owner.call(trips.GET, "GET", "/api/trips")).body.items[0].id;
    process.env.OPENAI_API_KEY = "sk-test-fakekey-1234567890";
    process.env.OPENAI_BASE_URL = fake.baseURL;
    fake.setResponder(() => ({ json: { value: "ek_test_secret", expires_at: 1_900_000_000, session: {} } }));
    const denied = await other.call(voice.POST, "POST", "/api/ai/voice/session", { tripId });
    expect([403, 404]).toContain(denied.status);
    const ok = await owner.call(voice.POST, "POST", "/api/ai/voice/session", { tripId });
    expect(ok.status).toBe(200);
    expect(ok.body.clientSecret).toBe("ek_test_secret");
    expect(JSON.stringify(ok.body)).not.toContain("sk-test-fakekey");
    const sessionReq = fake.requests.find((r) => r.path.includes("realtime/client_secrets"))!;
    expect(sessionReq.body).toMatchObject({ session: { type: "realtime", audio: { input: { turn_detection: { create_response: false } } } } });
    delete process.env.OPENAI_API_KEY;
    const mock = await owner.call(voice.POST, "POST", "/api/ai/voice/session", { tripId });
    expect(mock.status).toBe(503);
    expect(mock.body.error.code).toBe("voice_unavailable");
  });
});

describe("AI quota exhaustion", () => {
  it("keeps planning with the rules engine and says so honestly", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fakekey-1234567890";
    process.env.OPENAI_BASE_URL = fake.baseURL;
    process.env.AI_MAX_RETRIES = "0";
    fake.setResponder(() => ({ status: 429, json: { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } } }));
    const c = new TestClient();
    const tripId = await newTrip(c);
    const r = await say(c, tripId, "Maldives for 4 days");
    expect(r.status).toBe(200);
    expect(r.body.profile.destinationId).toBe("maldives");
    expect(r.body.ai.notice).toMatch(/quota/i);
    const rec = all<{ outcome: string; error_code: string | null }>("SELECT outcome, error_code FROM usage_records ORDER BY created_at DESC LIMIT 1")[0];
    expect(rec.error_code).toBe("quota_exhausted");
  });
});

describe("validated business tools", () => {
  it("requires explicit confirmation before creating a booking handoff", async () => {
    const c = await as("customer@pyt-demo.test");
    const trip = (await c.call(trips.GET, "GET", "/api/trips")).body.items.find((t: { itinerary_id: string | null; handoff_status: string | null }) => t.itinerary_id && !t.handoff_status);
    const customer = get<{ id: string; name: string; role: string }>("SELECT id, name, role FROM users WHERE email = 'customer@pyt-demo.test'")!;
    const actor = { userId: customer.id, role: "customer", anonId: "", key: `user:${customer.id}`, ip: "t", user: { ...customer, email: "customer@pyt-demo.test", phone: null }, isNewAnon: false } as never;
    const before = get<{ c: number }>("SELECT COUNT(*) c FROM booking_handoffs WHERE trip_id = ?", [trip.id])!.c;
    const r = await executeTool({ actor, source: "planner", conversationId: null }, "create_booking_handoff", {
      tripId: trip.id,
      contactName: "Meera Krishnan",
      contactEmail: "meera@example.com",
      idempotencyKey: "tool-test-key-123",
    });
    expect(r.status).toBe("proposed");
    expect(get<{ c: number }>("SELECT COUNT(*) c FROM booking_handoffs WHERE trip_id = ?", [trip.id])!.c).toBe(before);
  });

  it("validates arguments and ownership for edit_itinerary", async () => {
    const owner = await as("customer@pyt-demo.test");
    const trip = (await owner.call(trips.GET, "GET", "/api/trips")).body.items.find((t: { itinerary_id: string | null }) => t.itinerary_id);
    const other = get<{ id: string; name: string }>("SELECT id, name FROM users WHERE email = 'customer2@pyt-demo.test'")!;
    const actor = { userId: other.id, role: "customer", anonId: "", key: `user:${other.id}`, ip: "t", user: { ...other, role: "customer", email: "x", phone: null }, isNewAnon: false } as never;
    const forbidden = await executeTool({ actor, source: "planner", conversationId: null }, "edit_itinerary", { tripId: trip.id, edit: { op: "setHotelTier", tier: "budget" } });
    expect(forbidden.status).toBe("failed");
    const invalid = await executeTool({ actor, source: "planner", conversationId: null }, "edit_itinerary", { tripId: trip.id, edit: { op: "dropDatabase" } });
    expect(invalid.status).toBe("failed");
  });
});

describe("performance measurement", () => {
  it("adds Server-Timing headers and exposes measured latency only to admins", async () => {
    const admin = await as("admin@pyt-demo.test");
    const c = new TestClient();
    const tripId = await newTrip(c);
    const r = await c.call(prefsById.GET, "GET", `/api/trips/preferences/${tripId}`, undefined, { id: tripId });
    expect(r.headers.get("server-timing")).toMatch(/app;dur=[\d.]+, db;dur=[\d.]+;desc="\d+ queries"/);
    const sales = await as("sales@pyt-demo.test");
    expect((await sales.call(performance.GET, "GET", "/api/admin/performance")).status).toBe(403);
    const m = await admin.call(performance.GET, "GET", "/api/admin/performance");
    expect(m.status).toBe(200);
    const route = m.body.routes.find((x: { route: string }) => x.route === "GET /api/trips/preferences/:id");
    expect(route).toMatchObject({ count: expect.any(Number), p50: expect.any(Number), p95: expect.any(Number), avgQueries: expect.any(Number) });
    expect(Array.isArray(m.body.ai)).toBe(true);
  });
});

describe("data retention", () => {
  it("purges abandoned guest planning data but keeps anything linked to a lead", async () => {
    const guest = new TestClient();
    const abandoned = await newTrip(guest);
    await say(guest, abandoned, "Thailand");
    const keep = await newTrip(guest);
    await say(guest, keep, "A 5 day trip to Bali in May for 2 adults, budget 2 lakh total");
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    run("UPDATE trips SET updated_at = ? WHERE id IN (?, ?)", [old, abandoned, keep]);
    run("UPDATE conversations SET updated_at = ? WHERE trip_id IN (?, ?)", [old, abandoned, keep]);
    const lead = get<{ id: string }>("SELECT id FROM leads WHERE trip_id = ?", [keep]);
    expect(lead).toBeTruthy();
    const result = purgeExpiredData({ guestDays: 90, usageDays: 400 });
    expect(result.guestTrips).toBeGreaterThanOrEqual(1);
    expect(get("SELECT id FROM trips WHERE id = ?", [abandoned])).toBeUndefined();
    expect(get<{ c: number }>("SELECT COUNT(*) c FROM conversations WHERE trip_id = ?", [abandoned])!.c).toBe(0);
    expect(get("SELECT id FROM trips WHERE id = ?", [keep])).toBeTruthy();
  });
});

describe("generate after itinerary (reuse)", () => {
  it("returns the saved itinerary without regenerating when inputs are unchanged", async () => {
    const c = new TestClient();
    const tripId = await newTrip(c);
    await say(c, tripId, "A 4 day trip to Singapore in March for 2 adults, budget 2 lakh total");
    const first = await c.call(generate.POST, "POST", "/api/itineraries/generate", { tripId });
    expect(first.status).toBe(201);
    const second = await c.call(generate.POST, "POST", "/api/itineraries/generate", { tripId });
    expect(second.body.reused).toBe(true);
    expect(second.body.itinerary.id).toBe(first.body.itinerary.id);
  });
});
