import { describe, expect, it } from "vitest";
import { can, canAccessTicket, canAccessTrip, isEmployee, ownsRecord, ROLES } from "@/lib/auth/permissions";
import { toStrictJsonSchema } from "@/lib/ai/json-schema";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { LlmExtractionSchema } from "@/lib/planner/extraction";
import { emptyProfile } from "@/lib/planner/profile";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";
import { canTransitionLead, canTransitionTicket, qualifiesAsLead, scoreLead, triageMessage } from "@/lib/workflows/rules";
import { firstResponseSla } from "@/lib/workflows/sla";
import { suggestNextAction } from "@/lib/workflows/next-action";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { z } from "zod";

describe("lead stage transitions", () => {
  it("allows the sales pipeline and blocks skipping to won", () => {
    expect(canTransitionLead("new", "contacted")).toBe(true);
    expect(canTransitionLead("proposal_sent", "won")).toBe(true);
    expect(canTransitionLead("new", "won")).toBe(false);
    expect(canTransitionLead("won", "lost")).toBe(false);
    expect(canTransitionLead("lost", "contacted")).toBe(true);
  });

  it("qualifies and scores leads deterministically", () => {
    const p = { ...emptyProfile(), destinationId: "bali" };
    expect(qualifiesAsLead(p)).toBe(false);
    const q = { ...p, durationDays: 5, adults: 2 };
    expect(qualifiesAsLead(q)).toBe(true);
    const low = scoreLead(q, { hasContact: false, hasItinerary: false, handoffRequested: false });
    const high = scoreLead({ ...q, budgetAmount: 500000, budgetScope: "total" as const, travelMonth: "2026-11" }, { hasContact: true, hasItinerary: true, handoffRequested: true, today: new Date("2026-10-19") });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(100);
  });
});

describe("support ticket rules", () => {
  it("enforces status transitions", () => {
    expect(canTransitionTicket("open", "in_progress")).toBe(true);
    expect(canTransitionTicket("resolved", "in_progress")).toBe(true);
    expect(canTransitionTicket("closed", "open")).toBe(false);
    expect(canTransitionTicket("escalated", "pending_customer")).toBe(false);
  });

  it("triages urgent travel problems and policy-sensitive requests", () => {
    expect(triageMessage("We missed our connecting flight and are stranded at the airport")).toMatchObject({ category: "emergency", priority: "urgent", escalate: true });
    expect(triageMessage("I lost my passport in Bangkok")).toMatchObject({ category: "emergency", urgent: true });
    expect(triageMessage("I want a refund for my cancelled trip")).toMatchObject({ category: "cancellation_refund", priority: "high", escalate: true });
    expect(triageMessage("Do I need a visa?")).toMatchObject({ category: "visa_documents", urgent: false });
    expect(triageMessage("Can I change my dates?", 2)).toMatchObject({ category: "booking_change", priority: "high" });
  });
});

describe("permissions", () => {
  it("gives each role only its permissions", () => {
    expect(can("customer", "leads:read")).toBe(false);
    expect(can("sales", "leads:write")).toBe(true);
    expect(can("sales", "tickets:read")).toBe(false);
    expect(can("support", "tickets:write")).toBe(true);
    expect(can("support", "leads:read")).toBe(false);
    expect(can("ops", "trips:write_ops")).toBe(true);
    expect(can("ops", "settings:manage")).toBe(false);
    expect(ROLES.filter((r) => can(r, "settings:manage"))).toEqual(["admin"]);
    expect(isEmployee("customer")).toBe(false);
    expect(can(null, "dashboard:read")).toBe(false);
  });

  it("restricts private records to their owner", () => {
    const anonA = { userId: null, role: null, anonId: "anon_aaaaaaaaaaaaaa" };
    const anonB = { userId: null, role: null, anonId: "anon_bbbbbbbbbbbbbb" };
    const trip = { user_id: null, anon_id: "anon_aaaaaaaaaaaaaa" };
    expect(ownsRecord(anonA, trip)).toBe(true);
    expect(ownsRecord(anonB, trip)).toBe(false);
    // Once claimed by an account, the anonymous cookie alone no longer grants access.
    const claimed = { user_id: "usr_1", anon_id: "anon_aaaaaaaaaaaaaa" };
    expect(ownsRecord(anonA, claimed)).toBe(false);
    expect(ownsRecord({ ...anonA, userId: "usr_1", role: "customer" }, claimed)).toBe(true);
    expect(canAccessTrip({ userId: "usr_9", role: "support", anonId: "anon_x" }, claimed)).toBe(true);
    expect(canAccessTicket({ userId: "usr_9", role: "sales", anonId: "anon_x" }, claimed)).toBe(false);
  });
});

describe("AI plumbing", () => {
  it("produces a strict JSON schema for structured outputs", () => {
    const schema = toStrictJsonSchema(LlmExtractionSchema);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(Object.keys(schema.properties as object));
    expect(JSON.stringify(schema)).not.toMatch(/"(minimum|maximum|\$schema)"/);
    const nested = toStrictJsonSchema(z.strictObject({ a: z.array(z.strictObject({ b: z.string().nullable() })) }));
    const items = (nested.properties as Record<string, { items: Record<string, unknown> }>).a.items;
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(["b"]);
  });

  it("estimates cost from token usage", () => {
    expect(estimateCostUsd("gpt-4.1-mini", 1_000_000, 0)).toBeCloseTo(0.4);
    expect(estimateCostUsd("gpt-4.1-mini", 1_000_000, 0, 1_000_000)).toBeCloseTo(0.1);
    expect(estimateCostUsd("unknown-model", 1000, 1000)).toBe(0);
  });

  it("rate limits per key within a window", () => {
    resetRateLimits();
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) expect(checkRateLimit("ai", ["ip-1"], now).allowed).toBe(true);
    const blocked = checkRateLimit("ai", ["ip-1"], now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(checkRateLimit("ai", ["ip-2"], now).allowed).toBe(true);
    expect(checkRateLimit("ai", ["ip-1"], now + 61_000).allowed).toBe(true);
  });

  it("hashes passwords with scrypt", () => {
    const h = hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
});

describe("support SLA indicators (configured rules)", () => {
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  const at = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
  it("flags overdue, at-risk and met first responses", () => {
    expect(firstResponseSla({ priority: "urgent", created_at: at(30), first_response_at: null, status: "open" }, now)?.state).toBe("breached");
    expect(firstResponseSla({ priority: "high", created_at: at(100), first_response_at: null, status: "open" }, now)?.state).toBe("at_risk");
    expect(firstResponseSla({ priority: "normal", created_at: at(60), first_response_at: null, status: "open" }, now)?.state).toBe("due");
    expect(firstResponseSla({ priority: "urgent", created_at: at(60), first_response_at: at(50), status: "open" }, now)?.state).toBe("met");
    expect(firstResponseSla({ priority: "low", created_at: at(60), first_response_at: null, status: "resolved" }, now)).toBeNull();
  });
});

describe("lead next best action (rule-based)", () => {
  const base = { stage: "qualified", email: "a@b.co", trip_status: "itinerary_ready", score: 60, next_follow_up_at: null };
  it("prioritises overdue follow-ups, then booking requests, then stage playbooks", () => {
    const now = Date.parse("2026-10-20T12:00:00.000Z");
    expect(suggestNextAction(base, [{ status: "pending", due_at: "2026-10-19T09:00:00.000Z" }], now)).toMatchObject({ urgency: "high", action: expect.stringMatching(/overdue/) });
    expect(suggestNextAction({ ...base, trip_status: "handoff_requested" }, [], now).action).toMatch(/quote/);
    expect(suggestNextAction({ ...base, stage: "new" }, [], now).action).toMatch(/first contact/);
    expect(suggestNextAction({ ...base, stage: "won" }, [], now).urgency).toBe("low");
    expect(suggestNextAction(base, [], now).action).toMatch(/proposal/);
  });
});
