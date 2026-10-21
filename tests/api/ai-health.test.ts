import { createServer, type AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestClient } from "../support/client";
import { EXTRACTION_TEMPLATE, responsesPayload, startFakeOpenAI } from "../support/fake-openai";
import { resetRateLimits } from "@/lib/rate-limit";
import { runAiHealthCheck } from "@/lib/ai/health";
import * as login from "@/app/api/auth/login/route";
import * as aiCheck from "@/app/api/admin/ai-check/route";

const KEY = "sk-test-healthcheck-key-0123456789";
let fake: Awaited<ReturnType<typeof startFakeOpenAI>>;
let missingModel: string | null = null;

beforeAll(async () => {
  fake = await startFakeOpenAI((req) => {
    if (req.path === "/v1/models" && !req.headers.authorization) return { status: 401, json: { error: { message: "Missing bearer token" } } };
    if (req.path.startsWith("/v1/models/")) {
      const id = decodeURIComponent(req.path.split("/").pop()!);
      return id === missingModel ? { status: 404, json: { error: { message: "The model does not exist", code: "model_not_found" } } } : { json: { id, object: "model", created: 1, owned_by: "openai" } };
    }
    if (req.path.includes("realtime/client_secrets")) return { json: { value: "ek_live_ephemeral_secret", expires_at: 1_900_000_000, session: {} } };
    return { json: responsesPayload({ ...EXTRACTION_TEMPLATE, destination: "Bali", durationDays: 5, travelMonth: "2026-12", adults: 2, children: 2, childrenAges: [6, 9], tripType: "family", budgetAmount: 150000, currency: "INR", budgetScope: "total" }) };
  });
});
afterAll(() => fake.close());
beforeEach(() => {
  resetRateLimits();
  missingModel = null;
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
});
const goLive = () => {
  process.env.OPENAI_API_KEY = KEY;
  process.env.OPENAI_BASE_URL = fake.baseURL;
  process.env.AI_MAX_RETRIES = "0";
};

describe("live AI health check", () => {
  it("reports every API check as BLOCKED (not passed) without a key", async () => {
    process.env.OPENAI_BASE_URL = fake.baseURL; // keep the network probe local and deterministic
    const r = await runAiHealthCheck();
    expect(r.mode).toBe("mock");
    expect(r.checks[0]).toMatchObject({ name: "Network & TLS reachability", status: "passed" });
    expect(r.checks.slice(1).every((c) => c.status === "blocked")).toBe(true);
  });

  it("reports a transport failure as a network failure, not a model problem", async () => {
    process.env.OPENAI_API_KEY = KEY;
    // A port that was just closed: the connection is refused at the socket level.
    const closed = await new Promise<number>((resolve) => {
      const srv = createServer().listen(0, "127.0.0.1", () => {
        const port = (srv.address() as AddressInfo).port;
        srv.close(() => resolve(port));
      });
    });
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${closed}/v1`;
    process.env.AI_MAX_RETRIES = "0";
    const r = await runAiHealthCheck();
    expect(r.checks[0]).toMatchObject({ name: "Network & TLS reachability", status: "failed" });
    const model = r.checks.find((c) => c.name === "Model available: routine")!;
    expect(model.status).toBe("failed");
    expect(model.diagnostics).toMatchObject({ code: "connection_error", errorClass: "APIConnectionError", status: null });
    expect(model.diagnostics?.causeCode).toBe("ECONNREFUSED");
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("passes configuration, model availability, a structured request and a voice session when live", async () => {
    goLive();
    const r = await runAiHealthCheck();
    expect(r.checks.map((c) => [c.name, c.status])).toEqual([
      ["Network & TLS reachability", "passed"],
      ["Configuration", "passed"],
      ["Model available: routine", "passed"],
      ["Model available: realtime", "passed"],
      ["Model available: transcription", "passed"],
      ["Structured trip-planning request", "passed"],
      ["Realtime voice session", "passed"],
    ]);
    const text = JSON.stringify(r);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("ek_live_ephemeral_secret");
  });

  it("fails clearly when the configured model isn't available to the project", async () => {
    goLive();
    missingModel = "gpt-6-luna";
    const r = await runAiHealthCheck();
    const model = r.checks.find((c) => c.name === "Model available: routine")!;
    expect(model.status).toBe("failed");
    expect(model.detail).toMatch(/model_unavailable/);
  });

  it("is admin-only over the API", async () => {
    goLive();
    const sales = new TestClient();
    await sales.call(login.POST, "POST", "/api/auth/login", { email: "sales@pyt-demo.test", password: "demo1234" });
    expect((await sales.call(aiCheck.POST, "POST", "/api/admin/ai-check")).status).toBe(403);
    const admin = new TestClient();
    await admin.call(login.POST, "POST", "/api/auth/login", { email: "admin@pyt-demo.test", password: "demo1234" });
    const r = await admin.call(aiCheck.POST, "POST", "/api/admin/ai-check");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(KEY);
  });
});

