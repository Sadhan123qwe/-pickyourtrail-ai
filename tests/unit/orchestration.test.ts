import { describe, expect, it } from "vitest";
import { routeCommand, DRAFT_PLACEHOLDER } from "@/lib/ai/command-router";
import { detectRevision, matchItem } from "@/lib/planner/revisions";
import { extractWithRules } from "@/lib/planner/rules-extractor";
import { emptyProfile } from "@/lib/planner/profile";

describe("command router (deterministic tool planning)", () => {
  it.each([
    ["Show me leads who planned a trip but haven't continued to booking", "find_stalled_leads"],
    ["Find support cases that need urgent attention", "find_urgent_support_cases"],
    ["Show trips where the budget exceeds the customer's stated limit", "find_over_budget_trips"],
    ["Summarize today's operational exceptions", "get_operational_exceptions"],
    ["How is the business doing this month?", "get_business_metrics"],
    ["What needs my attention right now?", "get_pending_operations"],
  ])("routes “%s” to %s with high confidence", (message, tool) => {
    const plan = routeCommand(message);
    expect(plan.confidence).toBe("high");
    expect(plan.calls.map((c) => c.tool)).toEqual([tool]);
  });

  it("uses the attached lead for summaries and follow-ups", () => {
    const summary = routeCommand("Summarize this customer's requirements and conversation", { leadId: "lead_1" });
    expect(summary.calls.map((c) => c.tool)).toEqual(["get_lead_summary", "get_customer_context"]);
    const follow = routeCommand("Prepare a follow-up message for this lead", { leadId: "lead_1" });
    expect(follow.calls).toEqual([
      { tool: "draft_follow_up_message", args: { leadId: "lead_1", channel: "whatsapp" } },
      { tool: "schedule_follow_up", args: { leadId: "lead_1", channel: "whatsapp", message: DRAFT_PLACEHOLDER } },
    ]);
  });

  it("finds a lead by name when none is attached", () => {
    expect(routeCommand('Summarize the lead "Ishita Bose"').calls[0]).toEqual({ tool: "get_lead_summary", args: { nameQuery: "Ishita Bose" } });
  });

  it("never pretends to send messages, issue refunds or change bookings", () => {
    const send = routeCommand("Send the follow-up now", { leadId: "lead_1" });
    expect(send.intent).toBe("not_available");
    expect(send.calls.every((c) => !["schedule_follow_up", "update_lead_stage"].includes(c.tool))).toBe(true);
    expect(send.note).toMatch(/can't send/);
    const refund = routeCommand("Issue a refund for PYT-1004");
    expect(refund.intent).toBe("not_available");
    expect(refund.note).toMatch(/can't issue refunds/);
  });

  it("only proposes writes for explicitly requested changes with a target", () => {
    expect(routeCommand("Assign this ticket to me", { ticketId: "tkt_1" }).calls).toEqual([{ tool: "assign_ticket", args: { ticketId: "tkt_1", assigneeId: "me" } }]);
    expect(routeCommand("Move this lead to qualified", { leadId: "lead_1" }).calls[0]).toEqual({ tool: "update_lead_stage", args: { leadId: "lead_1", stage: "qualified" } });
    expect(routeCommand("Prepare a follow-up message").calls).toEqual([]);
  });

  it("routes policy questions to knowledge search, and falls back to it with low confidence otherwise", () => {
    const p = routeCommand("What's our policy on visa assistance?");
    expect(p.confidence).toBe("high");
    expect(p.calls[0].tool).toBe("search_company_knowledge");
    const vague = routeCommand("Anything interesting about Bali lately?");
    expect(vague.confidence).toBe("low");
    expect(vague.calls[0].tool).toBe("search_company_knowledge");
  });
});

describe("planner revision detection", () => {
  it.each([
    ["Can you make it slower?", { pace: "relaxed" }],
    ["Make it more adventurous", { pace: "packed", addInterests: ["adventure"] }],
    ["Show cheaper options", { cheaper: true }],
    ["This is too expensive", { cheaper: true }],
    ["save my trip", { save: true }],
    ["replace the water park", { replaceQuery: "water park" }],
    ["remove the spa from my itinerary", { removeQuery: "spa" }],
    ["More cultural experiences please", { addInterests: ["culture"] }],
    ["Make it more family-friendly", { addInterests: ["family_fun"] }],
  ])("detects “%s”", (message, expected) => {
    expect(detectRevision(message)).toMatchObject(expected);
  });

  it("ignores ordinary answers", () => {
    expect(detectRevision("2 adults and 2 kids")).toBeNull();
    expect(detectRevision("from Chennai")).toBeNull();
  });

  it("matches activities from the customer's words", () => {
    const items = [
      { id: "a", kind: "activity", title: "Waterbom Bali water park" },
      { id: "b", kind: "activity", title: "Balinese spa & flower bath" },
      { id: "c", kind: "transfer", title: "Arrive at Denpasar" },
    ];
    expect(matchItem(items, "the water park")?.id).toBe("a");
    expect(matchItem(items, "spa")?.id).toBe("b");
    expect(matchItem(items, "airport")).toBeUndefined();
  });
});

describe("extraction regressions found in the audit", () => {
  const today = new Date("2026-10-19T10:00:00Z");
  it("does not read budget numbers as children's ages", () => {
    const r = extractWithRules("2 adults 2 kids aged 6 and 9, budget 3 lakh total incl flights", { lastQuestion: null, profile: emptyProfile(), today });
    expect(r.updates.childrenAges).toEqual([6, 9]);
    expect(r.updates.budgetAmount).toBe(300000);
  });
  it("treats 'budget' as a hotel level only when no amount is given", () => {
    expect(extractWithRules("change the budget to 2 lakh", { lastQuestion: "accommodation", profile: emptyProfile(), today }).updates.accommodation).toBeUndefined();
    expect(extractWithRules("budget is fine", { lastQuestion: "accommodation", profile: emptyProfile(), today }).updates.accommodation).toBe("budget");
  });
});

describe("employee copilot prompts", () => {
  it("routes the copilot's suggested prompts to the right read tools", () => {
    expect(routeCommand("Which leads need follow-up today?").calls[0].tool).toBe("find_follow_ups_due");
    expect(routeCommand("Which of my leads need follow-up today?").calls[0].args).toMatchObject({ mine: true });
    expect(routeCommand("Summarize unresolved cases assigned to me").calls[0].tool).toBe("find_my_open_tickets");
    const policy = routeCommand("Explain the approved cancellation policy");
    expect(policy.calls[0].tool).toBe("search_company_knowledge");
    expect(policy.confidence).toBe("high");
    const reqs = routeCommand("Summarize this lead's travel requirements", { leadId: "lead_1" });
    expect(reqs.calls.map((c) => c.tool)).toEqual(["get_lead_summary", "get_customer_context"]);
  });

  it("still drafts (not lists) when asked to prepare a follow-up", () => {
    const plan = routeCommand("Draft a follow-up for this customer", { leadId: "lead_1" });
    expect(plan.calls[0].tool).toBe("draft_follow_up_message");
  });
});
