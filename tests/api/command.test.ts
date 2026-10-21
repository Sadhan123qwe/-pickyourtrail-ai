import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestClient } from "../support/client";
import { responsesPayload, startFakeOpenAI } from "../support/fake-openai";
import { resetRateLimits } from "@/lib/rate-limit";
import { all, get } from "@/lib/db";
import * as login from "@/app/api/auth/login/route";
import * as commandChat from "@/app/api/command/chat/route";
import * as overview from "@/app/api/command/overview/route";
import * as confirm from "@/app/api/command/actions/[id]/confirm/route";
import * as reject from "@/app/api/command/actions/[id]/reject/route";
import * as leads from "@/app/api/leads/route";
import * as leadById from "@/app/api/leads/[id]/route";
import * as search from "@/app/api/search/route";
import * as notifications from "@/app/api/notifications/route";
import * as customers from "@/app/api/customers/route";
import * as customerByKey from "@/app/api/customers/[key]/route";
import * as knowledge from "@/app/api/knowledge/route";
import * as settings from "@/app/api/settings/overview/route";
import * as chat from "@/app/api/ai/chat/route";
import * as start from "@/app/api/trips/preferences/route";
import * as generate from "@/app/api/itineraries/generate/route";
import * as tripById from "@/app/api/trips/[id]/route";

async function as(email: string) {
  const c = new TestClient();
  expect((await c.call(login.POST, "POST", "/api/auth/login", { email, password: "demo1234" })).status).toBe(200);
  return c;
}

async function anyLead(c: TestClient) {
  return (await c.call(leads.GET, "GET", "/api/leads?stage=qualified")).body.items[0] as { id: string; name: string };
}

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

describe("AI Command Center", () => {
  it("is only available to authenticated employees", async () => {
    const anon = new TestClient();
    expect((await anon.call(commandChat.POST, "POST", "/api/command/chat", { message: "show stalled leads" })).status).toBe(401);
    const customer = await as("customer@pyt-demo.test");
    expect((await customer.call(commandChat.POST, "POST", "/api/command/chat", { message: "show stalled leads" })).status).toBe(403);
    expect((await customer.call(overview.GET, "GET", "/api/command/overview")).status).toBe(403);
  });

  it("answers read requests from authorized tools and cites the records used", async () => {
    const sales = await as("sales@pyt-demo.test");
    const r = await sales.call(commandChat.POST, "POST", "/api/command/chat", { message: "Show me leads who planned a trip but haven't continued to booking" });
    expect(r.status).toBe(200);
    expect(r.body.toolCalls).toHaveLength(1);
    expect(r.body.toolCalls[0]).toMatchObject({ tool: "find_stalled_leads", kind: "read", status: "completed" });
    expect(r.body.records.length).toBeGreaterThan(0);
    // Every cited lead really is a stalled lead in the database.
    for (const rec of r.body.records) {
      const row = get<{ stage: string; handoffs: number }>("SELECT l.stage, (SELECT COUNT(*) FROM booking_handoffs h WHERE h.trip_id = l.trip_id) handoffs FROM leads l WHERE l.id = ?", [rec.id])!;
      expect(["new", "contacted", "qualified", "proposal_sent"]).toContain(row.stage);
      expect(row.handoffs).toBe(0);
    }
    expect(r.body.ai.planner).toBe("rules"); // confident routing: no planning call to the model
    // The conversation is persisted.
    const history = await sales.call(commandChat.GET, "GET", "/api/command/chat");
    expect(history.body.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses data outside the employee's role without counting it as an operational failure", async () => {
    const support = await as("support@pyt-demo.test");
    const r = await support.call(commandChat.POST, "POST", "/api/command/chat", { message: "Show me leads who planned a trip but haven't continued to booking" });
    expect(r.body.toolCalls[0]).toMatchObject({ status: "failed", error: "forbidden" });
    expect(r.body.records).toHaveLength(0);
    expect(r.body.answer).toMatch(/doesn't have access/);
    const ov = await support.call(overview.GET, "GET", "/api/command/overview");
    expect(ov.body.queues.stalledLeads).toBeNull();
    expect(ov.body.queues.exceptions.some((e: { type: string }) => e.type === "failed_action")).toBe(false);
  });

  it("proposes consequential actions and only executes them after explicit approval", async () => {
    const sales = await as("sales@pyt-demo.test");
    const lead = await anyLead(sales);
    const followUps = () => get<{ c: number }>("SELECT COUNT(*) c FROM follow_ups WHERE lead_id = ?", [lead.id])!.c;
    const before = followUps();

    const r = await sales.call(commandChat.POST, "POST", "/api/command/chat", { message: "Prepare a follow-up message for this lead", context: { leadId: lead.id } });
    expect(r.body.draft).toMatch(new RegExp(`Hi ${lead.name.split(" ")[0]}`));
    expect(r.body.pendingActions).toHaveLength(1);
    const pending = r.body.pendingActions[0];
    expect(pending).toMatchObject({ tool: "schedule_follow_up", status: "proposed" });
    expect(pending.description).toMatch(/Nothing is sent to the customer/);
    expect(followUps()).toBe(before); // nothing happened yet
    expect(r.body.answer).not.toMatch(/scheduled for/); // no premature success claims

    // Another sales rep can't approve someone else's proposal.
    const other = await as("sales2@pyt-demo.test");
    expect((await other.call(confirm.POST, "POST", "", {}, { id: pending.actionId })).status).toBe(403);

    const ok = await sales.call(confirm.POST, "POST", "", {}, { id: pending.actionId });
    expect(ok.status).toBe(200);
    expect(ok.body.action.status).toBe("completed");
    expect(followUps()).toBe(before + 1);
    const detail = await sales.call(leadById.GET, "GET", "", undefined, { id: lead.id });
    expect(detail.body.activities.some((a: { type: string }) => a.type === "follow_up_prepared")).toBe(true);
    expect((await sales.call(confirm.POST, "POST", "", {}, { id: pending.actionId })).status).toBe(409);
    expect(get<{ c: number }>("SELECT COUNT(*) c FROM audit_events WHERE entity_type = 'ai_action' AND entity_id = ? AND action = 'confirmed'", [pending.actionId])!.c).toBe(1);
  });

  it("rejected proposals never run", async () => {
    const sales = await as("sales@pyt-demo.test");
    const lead = await anyLead(sales);
    const r = await sales.call(commandChat.POST, "POST", "/api/command/chat", { message: "Move this lead to proposal sent", context: { leadId: lead.id } });
    const id = r.body.pendingActions[0].actionId;
    const rej = await sales.call(reject.POST, "POST", "", {}, { id });
    expect(rej.body.action.status).toBe("rejected");
    expect(get<{ stage: string }>("SELECT stage FROM leads WHERE id = ?", [lead.id])!.stage).toBe("qualified");
    expect((await sales.call(confirm.POST, "POST", "", {}, { id })).status).toBe(409);
  });

  it("validates proposals against business rules before asking for approval", async () => {
    const sales = await as("sales@pyt-demo.test");
    const lead = await anyLead(sales);
    const r = await sales.call(commandChat.POST, "POST", "/api/command/chat", { message: "Move this lead to won", context: { leadId: lead.id } });
    expect(r.body.pendingActions).toHaveLength(0);
    expect(r.body.toolCalls[0]).toMatchObject({ tool: "update_lead_stage", status: "failed" });
    expect(r.body.toolCalls[0].summary).toMatch(/can't move from qualified to won/);
  });

  it("does not let the model escalate privileges or bypass validation (live planner via fake OpenAI)", async () => {
    process.env.OPENAI_API_KEY = "sk-test-fakekey-1234567890";
    process.env.OPENAI_BASE_URL = fake.baseURL;
    fake.requests.length = 0;
    fake.setResponder((req) =>
      req.body.text && (req.body.text as { format: { name: string } }).format.name === "command_plan"
        ? {
            json: responsesPayload({
              calls: [
                { tool: "find_stalled_leads", argumentsJson: "{}" },
                { tool: "drop_table_leads", argumentsJson: "{}" },
                { tool: "find_urgent_support_cases", argumentsJson: '{"limit": "lots"}' },
              ],
              note: null,
            }),
          }
        : { json: responsesPayload({ answer: "Here is what I found.", nextSteps: [] }) },
    );
    const support = await as("support@pyt-demo.test");
    const r = await support.call(commandChat.POST, "POST", "/api/command/chat", { message: "Give me a quick rundown of things" });
    expect(r.body.ai.planner).toBe("live");
    const byTool = Object.fromEntries(r.body.toolCalls.map((c: { tool: string; error: string }) => [c.tool, c.error]));
    expect(byTool.find_stalled_leads).toBe("forbidden"); // not in the support role's tools
    expect(byTool.drop_table_leads).toBe("unknown_tool");
    expect(byTool.find_urgent_support_cases).toBe("invalid_arguments");
    // The model was only shown the tools this role may use.
    const planReq = fake.requests.find((x) => (x.body.text as { format: { name: string } }).format.name === "command_plan")!;
    expect(planReq.body.instructions).toContain("find_urgent_support_cases");
    expect(planReq.body.instructions).not.toContain("find_stalled_leads");
    expect(planReq.body.instructions).not.toContain("update_lead_stage");
  });
});

describe("customer planner revisions through tools", () => {
  it("revises the saved itinerary from chat and logs the AI actions", async () => {
    const c = new TestClient();
    const tripId = (await c.call(start.POST, "POST", "/api/trips/preferences")).body.trip.id as string;
    await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "5-day family trip to Bali in December, 2 adults 2 kids aged 6 and 9, budget 3 lakh total incl flights" });
    await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "flexible" });
    const g = await c.call(generate.POST, "POST", "/api/itineraries/generate", { tripId });
    const v1 = g.body.itinerary;

    const slower = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "Can you make it slower and cheaper?" });
    expect(slower.body.profile.pace).toBe("relaxed");
    expect(slower.body.turn.itineraryUpdate.actions.map((a: { tool: string }) => a.tool)).toEqual(["generate_itinerary", "make_itinerary_cheaper"]);
    expect(slower.body.turn.itineraryUpdate.version).toBe(2);
    expect(slower.body.turn.itineraryUpdate.total).toBeLessThan(v1.budget.total);
    expect(slower.body.turn.reply).not.toMatch(/travel expert/); // not treated as a side question

    const budget = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "change the budget to 2 lakh" });
    expect(budget.body.profile.budgetAmount).toBe(200000);
    expect(budget.body.turn.itineraryUpdate.actions[0].tool).toBe("calculate_trip_budget"); // re-priced in code, no regeneration
    expect(budget.body.turn.itineraryUpdate.version).toBe(2);
    expect(budget.body.turn.reply).toMatch(/Updated budget/);

    const save = await c.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "save my trip" });
    expect(save.body.turn.reply).toMatch(/Saved to My Trips/);
    expect((await c.call(tripById.GET, "GET", "", undefined, { id: tripId })).body.trip.status).toBe("saved");

    const logged = all<{ tool: string; status: string; source: string }>("SELECT tool, status, source FROM ai_actions WHERE source = 'planner' AND args_json LIKE ?", [`%${tripId}%`]);
    expect(logged.map((l) => l.tool)).toEqual(expect.arrayContaining(["generate_itinerary", "make_itinerary_cheaper", "calculate_trip_budget", "save_trip"]));
    expect(logged.every((l) => l.status === "completed")).toBe(true);
  });

  it("a customer can't revise someone else's trip through the planner tools", async () => {
    const owner = new TestClient();
    const tripId = (await owner.call(start.POST, "POST", "/api/trips/preferences")).body.trip.id as string;
    const intruder = new TestClient();
    expect((await intruder.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message: "make it cheaper" })).status).toBe(403);
  });
});

describe("workspace APIs respect permissions", () => {
  it("global search only returns record types the employee may see", async () => {
    const support = await as("support@pyt-demo.test");
    const s = await support.call(search.GET, "GET", "/api/search?q=bali");
    const labels = s.body.groups.map((g: { label: string }) => g.label);
    expect(labels).not.toContain("Leads");
    const sales = await as("sales@pyt-demo.test");
    const s2 = await sales.call(search.GET, "GET", "/api/search?q=PYT-10");
    expect(s2.body.groups.map((g: { label: string }) => g.label)).not.toContain("Support tickets");
    expect((await new TestClient().call(search.GET, "GET", "/api/search?q=bali")).status).toBe(401);
  });

  it("customer profiles hide sections the role can't access", async () => {
    const support = await as("support@pyt-demo.test");
    const list = await support.call(customers.GET, "GET", "/api/customers");
    expect(list.body.total).toBeGreaterThan(0);
    const key = list.body.items[0].key as string;
    const detail = await support.call(customerByKey.GET, "GET", "", undefined, { key: encodeURIComponent(key) });
    expect(detail.body.leads).toBeNull();
    expect(Array.isArray(detail.body.tickets)).toBe(true);
    const ops = await as("ops@pyt-demo.test");
    expect((await ops.call(customers.GET, "GET", "/api/customers")).status).toBe(200);
    expect((await (await as("customer@pyt-demo.test")).call(customers.GET, "GET", "/api/customers")).status).toBe(403);
  });

  it("notifications and settings are derived server-side and never expose secrets", async () => {
    process.env.OPENAI_API_KEY = "sk-test-secret-should-not-leak-123";
    const admin = await as("admin@pyt-demo.test");
    const n = await admin.call(notifications.GET, "GET", "/api/notifications");
    expect(n.body.ai).toMatchObject({ mode: "live" });
    const s = await admin.call(settings.GET, "GET", "/api/settings/overview");
    expect(s.body.ai.apiKeyConfigured).toBe(true);
    expect(JSON.stringify([n.body, s.body])).not.toMatch(/sk-test-secret/);
  });

  it("only admins can publish knowledge, and new documents are used for grounded answers", async () => {
    const sales = await as("sales@pyt-demo.test");
    const doc = { title: "Group booking discounts (test)", category: "Sales", audience: "internal", tags: "group discount ten travellers", body: "Groups of ten or more travellers may receive a group rate after ops confirms with suppliers. Never promise a fixed percentage." };
    expect((await sales.call(knowledge.POST, "POST", "/api/knowledge", doc)).status).toBe(403);
    const admin = await as("admin@pyt-demo.test");
    expect((await admin.call(knowledge.POST, "POST", "/api/knowledge", doc)).status).toBe(201);
    const r = await sales.call(commandChat.POST, "POST", "/api/command/chat", { message: "What is our policy on group discounts for ten travellers?" });
    expect(r.body.records.some((x: { label: string }) => x.label.startsWith("Group booking discounts"))).toBe(true);
  });
});

describe("Employee AI Copilot workspace", () => {
  it("answers 'which leads need follow-up today' and 'my unresolved cases' from records", async () => {
    const sales = await as("sales@pyt-demo.test");
    const due = await sales.call(commandChat.POST, "POST", "/api/command/chat", { message: "Which leads need follow-up today?" });
    expect(due.status).toBe(200);
    expect(due.body.toolCalls[0]).toMatchObject({ tool: "find_follow_ups_due", status: "completed" });
    const expected = all<{ lead_id: string }>(
      "SELECT DISTINCT f.lead_id FROM follow_ups f JOIN leads l ON l.id = f.lead_id WHERE f.status = 'pending' AND f.due_at <= ? AND l.stage NOT IN ('won','lost')",
      [new Date(new Date().setUTCHours(23, 59, 59, 999)).toISOString()],
    ).map((r) => r.lead_id);
    for (const rec of due.body.records) expect(expected).toContain(rec.id);

    const support = await as("support@pyt-demo.test");
    const mine = await support.call(commandChat.POST, "POST", "/api/command/chat", { message: "Summarize unresolved cases assigned to me" });
    expect(mine.body.toolCalls[0]).toMatchObject({ tool: "find_my_open_tickets", status: "completed" });
    const me = get<{ id: string }>("SELECT id FROM users WHERE email = 'support@pyt-demo.test'")!;
    for (const rec of mine.body.records) {
      const t = get<{ assigned_to: string; status: string }>("SELECT assigned_to, status FROM support_tickets WHERE id = ?", [rec.id])!;
      expect(t.assigned_to).toBe(me.id);
      expect(["resolved", "closed"]).not.toContain(t.status);
    }
    // Support staff can't read the sales follow-up queue through the copilot.
    const denied = await support.call(commandChat.POST, "POST", "/api/command/chat", { message: "Which leads need follow-up today?" });
    expect(denied.body.toolCalls[0].status).not.toBe("completed");
  });

  it("returns a rule-based next action and conversation summary on lead detail", async () => {
    const sales = await as("sales@pyt-demo.test");
    const lead = await anyLead(sales);
    const detail = await sales.call(leadById.GET, "GET", "", undefined, { id: lead.id });
    expect(detail.body.nextAction).toMatchObject({ action: expect.any(String), reason: expect.any(String), urgency: expect.stringMatching(/high|medium|low/) });
    expect(detail.body).toHaveProperty("conversation");
  });
});
