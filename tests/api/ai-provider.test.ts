import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestClient } from "../support/client";
import { EXTRACTION_TEMPLATE, responsesPayload, startFakeOpenAI } from "../support/fake-openai";
import { resetRateLimits } from "@/lib/rate-limit";
import { all } from "@/lib/db";
import { updateAiSettings, DEFAULT_AI_SETTINGS } from "@/lib/ai/usage";
import * as chat from "@/app/api/ai/chat/route";
import * as status from "@/app/api/ai/status/route";
import * as start from "@/app/api/trips/preferences/route";
import * as generate from "@/app/api/itineraries/generate/route";
import * as voice from "@/app/api/ai/voice/session/route";

let fake: Awaited<ReturnType<typeof startFakeOpenAI>>;

function liveEnv(baseURL = fake.baseURL) {
  process.env.OPENAI_API_KEY = "sk-test-fakekey-1234567890";
  process.env.OPENAI_BASE_URL = baseURL;
  process.env.AI_MAX_RETRIES = "0";
  process.env.AI_TIMEOUT_MS = "5000";
}

function mockEnv() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
}

async function newTrip(c: TestClient) {
  const r = await c.call(start.POST, "POST", "/api/trips/preferences");
  return r.body.trip.id as string;
}

beforeAll(async () => {
  fake = await startFakeOpenAI(() => ({ json: responsesPayload({}) }));
});
afterAll(async () => {
  mockEnv();
  await fake.close();
});
beforeEach(() => {
  resetRateLimits();
  fake.requests.length = 0;
  updateAiSettings(DEFAULT_AI_SETTINGS);
});
afterEach(() => mockEnv());

describe("mock mode (no API key)", () => {
  it("reports mock mode and still plans trips with the rules engine", async () => {
    mockEnv();
    const c = new TestClient();
    const s = await c.call(status.GET, "GET", "/api/ai/status");
    expect(s.body.mode).toBe("mock");
    expect(s.body.reason).toMatch(/OPENAI_API_KEY is not configured/);
    expect(JSON.stringify(s.body)).not.toMatch(/sk-/);
    const tripId = await newTrip(c);
    const r = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "6 days in Bali" });
    expect(r.status).toBe(200);
    expect(r.body.ai.source).toBe("rules");
    expect(fake.requests).toHaveLength(0);
  });

  it("treats a malformed key as not configured", async () => {
    process.env.OPENAI_API_KEY = "not-a-key";
    const c = new TestClient();
    expect((await c.call(status.GET, "GET", "/api/ai/status")).body.mode).toBe("mock");
  });

  it("returns an honest 'voice unavailable' without a key", async () => {
    mockEnv();
    const c = new TestClient();
    const tripId = await newTrip(c);
    const r = await c.call(voice.POST, "POST", "/api/ai/voice/session", { tripId });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("voice_unavailable");
  });
});

describe("live adapter (fake OpenAI-compatible server)", () => {
  it("sends compact, structured requests and records usage and cost", async () => {
    liveEnv();
    fake.setResponder(() => ({ json: responsesPayload({ ...EXTRACTION_TEMPLATE, destination: "Bali", durationDays: 6, adults: 2, children: 0, sideQuestion: "Is it rainy?", sideAnswer: "It can be wet in December." }) }));
    const c = new TestClient();
    const tripId = await newTrip(c);
    const r = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "Bali for 6 days for two of us. Is it rainy?" });
    expect(r.status).toBe(200);
    expect(r.body.ai.source).toBe("live");
    expect(r.body.profile).toMatchObject({ destinationId: "bali", durationDays: 6, adults: 2 });
    expect(r.body.turn.reply).toMatch(/wet in December/);

    const req = fake.requests[0];
    expect(req.path).toBe("/v1/responses");
    expect(req.headers.authorization).toBe("Bearer sk-test-fakekey-1234567890");
    expect(req.body).toMatchObject({ model: "gpt-6-luna", store: false, max_output_tokens: 600, prompt_cache_key: "pyt-planner" });
    expect((req.body.text as { format: { type: string; strict: boolean } }).format).toMatchObject({ type: "json_schema", strict: true });
    const input = JSON.parse(req.body.input as string);
    expect(Object.keys(input).sort()).toEqual(["lastQuestion", "message", "profile", "today"]);

    // Second turn: the compact profile is sent, never the whole conversation history.
    fake.setResponder(() => ({ json: responsesPayload({ ...EXTRACTION_TEMPLATE, departureCity: "Mumbai" }) }));
    await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "From Mumbai" });
    const second = JSON.parse(fake.requests[1].body.input as string);
    expect(second.profile.destinationId).toBe("bali");
    expect(fake.requests[1].body.instructions).toBe(req.body.instructions); // stable prefix for prompt caching

    const usage = all<{ outcome: string; input_tokens: number; cached_tokens: number; est_cost_usd: number; model: string }>(
      "SELECT outcome, input_tokens, cached_tokens, est_cost_usd, model FROM usage_records WHERE provider = 'openai' AND category = 'planner'",
    );
    expect(usage.length).toBeGreaterThanOrEqual(2);
    expect(usage[0]).toMatchObject({ outcome: "ok", input_tokens: 420, cached_tokens: 256, model: "gpt-4.1-mini-test" });
    expect(usage[0].est_cost_usd).toBeGreaterThan(0);
  });

  it("only lets the model choose catalog activities; prices are computed in code", async () => {
    liveEnv();
    const c = new TestClient();
    const tripId = await newTrip(c);
    fake.setResponder(() => ({ json: responsesPayload({ ...EXTRACTION_TEMPLATE, destination: "Bali", durationDays: 3, adults: 2, children: 0, travelMonth: "2027-05", dateFlexibility: "flexible", budgetAmount: 200000, currency: "INR", budgetScope: "total" }) }));
    await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "Bali 3 days May 2 adults 2 lakh" });
    fake.setResponder(() => ({
      json: responsesPayload({
        summary: "A short Bali escape.",
        days: [
          { title: "Arrival", activityIds: ["bali-spa"], reasons: [{ activityId: "bali-spa", reason: "Unwind after the flight" }] },
          { title: "Ubud", activityIds: ["bali-rice", "invented-activity"], reasons: [] },
          { title: "Departure", activityIds: [], reasons: [] },
        ],
      }),
    }));
    const g = await c.call(generate.POST, "POST", "/api/itineraries/generate", { tripId });
    expect(g.status).toBe(201);
    const it = g.body.itinerary;
    expect(it.generatedBy).toMatch(/^openai:/);
    expect(it.summary).toBe("A short Bali escape.");
    const refs = it.days.flatMap((d: { items: { catalogRef: string | null }[] }) => d.items.map((i) => i.catalogRef)).filter(Boolean);
    expect(refs).toEqual(["bali-spa", "bali-rice"]); // the invented activity was dropped
    const spa = it.days[0].items.find((i: { catalogRef: string }) => i.catalogRef === "bali-spa");
    expect(spa.estCost).toBe(2800 * 2);
    expect(spa.reason).toBe("Unwind after the flight");
  });

  it("retries malformed output once, then falls back gracefully", async () => {
    liveEnv();
    fake.setResponder(() => ({ json: responsesPayload("this is not json") }));
    const c = new TestClient();
    const tripId = await newTrip(c);
    const r = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "5 days in Dubai" });
    expect(r.status).toBe(200);
    expect(fake.requests).toHaveLength(2);
    expect(r.body.ai.source).toBe("fallback");
    expect(r.body.profile.destinationId).toBe("dubai"); // rules extractor took over
    const u = all<{ outcome: string; error_code: string }>("SELECT outcome, error_code FROM usage_records WHERE error_code = 'malformed_output'");
    expect(u.length).toBeGreaterThan(0);
  });

  it("handles provider rate limits and server errors without failing the request", async () => {
    liveEnv();
    const c = new TestClient();
    const tripId = await newTrip(c);
    fake.setResponder(() => ({ status: 429, json: { error: { message: "Rate limit", type: "requests", code: "rate_limit_exceeded" } } }));
    const r1 = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "Singapore" });
    expect(r1.status).toBe(200);
    expect(r1.body.ai.notice).toMatch(/busy/);
    fake.setResponder(() => ({ status: 500, json: { error: { message: "boom" } } }));
    const r2 = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "4 days" });
    expect(r2.status).toBe(200);
    expect(r2.body.ai.source).toBe("fallback");
    expect(r2.body.profile.durationDays).toBe(4);
  });

  it("falls back when the provider is unreachable", async () => {
    liveEnv("http://127.0.0.1:9/v1");
    const c = new TestClient();
    const tripId = await newTrip(c);
    const r = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "Maldives honeymoon" });
    expect(r.status).toBe(200);
    expect(r.body.ai.source).toBe("fallback");
    expect(r.body.profile.destinationId).toBe("maldives");
    expect(all("SELECT 1 FROM usage_records WHERE error_code = 'connection_error'").length).toBeGreaterThan(0);
  });

  it("enforces the admin AI budget and the per-user daily limit before calling the provider", async () => {
    liveEnv();
    fake.setResponder(() => ({ json: responsesPayload({ ...EXTRACTION_TEMPLATE }) }));
    const c = new TestClient();
    const tripId = await newTrip(c);
    updateAiSettings({ monthlyBudgetUsd: 0 });
    const r = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "Japan" });
    expect(r.body.ai.notice).toMatch(/budget/);
    expect(fake.requests).toHaveLength(0);

    updateAiSettings({ monthlyBudgetUsd: 100, dailyRequestsPerActor: 1 });
    await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "7 days" });
    expect(fake.requests).toHaveLength(1);
    const limited = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "2 adults" });
    expect(limited.body.ai.notice).toMatch(/request limit/);
    expect(fake.requests).toHaveLength(1);
    expect(limited.body.profile.adults).toBe(2);
  });

  it("caches non-personal FAQ answers and reuses them without another AI call", async () => {
    liveEnv();
    fake.setResponder((req) => {
      const sources = JSON.parse(req.body.input as string).sources as { id: string }[];
      return { json: responsesPayload({ answer: "Cancellation charges depend on timing; an agent confirms refunds.", usedSourceIds: [sources[0].id], needsHuman: true }) };
    });
    const a = new TestClient();
    const r1 = await a.call(chat.POST, "POST", "/api/ai/chat", { mode: "support", message: "How do cancellation charges work?" });
    expect(r1.body.ai.source).toBe("live");
    expect(r1.body.sources.length).toBeGreaterThan(0);
    const b = new TestClient();
    const r2 = await b.call(chat.POST, "POST", "/api/ai/chat", { mode: "support", message: "How do cancellation charges work?" });
    expect(r2.body.ai.source).toBe("cache");
    expect(fake.requests).toHaveLength(1);
  });

  it("issues short-lived realtime client secrets server-side", async () => {
    liveEnv();
    fake.setResponder((req) => ({ json: req.path.includes("client_secrets") ? { value: "ek_test_secret", expires_at: 1_900_000_000, session: { type: "realtime" } } : {} }));
    const c = new TestClient();
    const tripId = await newTrip(c);
    const r = await c.call(voice.POST, "POST", "/api/ai/voice/session", { tripId });
    expect(r.status).toBe(200);
    expect(r.body.clientSecret).toBe("ek_test_secret");
    expect(JSON.stringify(r.body)).not.toMatch(/sk-test/);
    const sent = fake.requests.find((x) => x.path.includes("client_secrets"))!;
    expect(sent.body).toMatchObject({ expires_after: { anchor: "created_at", seconds: 600 } });
    expect((sent.body.session as { audio: { input: { turn_detection: { create_response: boolean } } } }).audio.input.turn_detection.create_response).toBe(false);
  });
});
