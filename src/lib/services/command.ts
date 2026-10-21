import "server-only";
import { z } from "zod";
import { runStructured } from "@/lib/ai/run";
import { routeCommand, DRAFT_PLACEHOLDER, type CommandContext, type CommandPlan, type PlannedCall } from "@/lib/ai/command-router";
import { executeTool, toolCatalog, toolsFor, type ToolExecution } from "@/lib/ai/tools/registry";
import { forbidden, notFound, type Actor } from "@/lib/http";
import { formatMoney } from "@/lib/planner/profile";
import { addMessage, createConversation, getConversation, latestConversationForOwner, listMessages } from "@/lib/repos/conversations";
import { listAiActions, type RecordRef } from "@/lib/repos/ai-actions";
import { can } from "@/lib/auth/permissions";
import {
  activeConversations,
  followUpsDue,
  handoffsNeedingAction,
  operationalExceptions,
  overBudgetTrips,
  stalledLeads,
  tripsAwaitingReview,
  urgentSupportCases,
} from "@/lib/repos/operations";

/**
 * AI Command Center orchestration. The model (when used) only chooses tools
 * and writes prose; every record it sees comes from an authorized, validated
 * tool call, and every consequential change waits for human approval.
 */

export interface CommandResponse {
  conversationId: string;
  answer: string;
  nextSteps: string[];
  draft: string | null;
  toolCalls: ToolExecution[];
  records: RecordRef[];
  pendingActions: ToolExecution[];
  ai: { planner: "rules" | "live" | "fallback" | "mock"; composer: "rules" | "live" | "fallback" | "mock"; notice: string | null };
}

const MAX_CALLS = 4;

function plannerSystem(catalog: string) {
  return `You route requests from travel-company employees to business tools.
Available tools (you may ONLY use these):
${catalog}
Rules:
- Choose 1–3 tools that answer the request. Prefer read tools. Use write tools only when the employee clearly asks for that change.
- argumentsJson must be a JSON object string with the tool's parameters. Use the provided context ids (leadId, ticketId, customerKey) when the request refers to "this lead/customer/ticket".
- To schedule a follow-up with a drafted message, call draft_follow_up_message first and pass "${DRAFT_PLACEHOLDER}" as the message.
- If no tool fits (e.g. sending messages, refunds, booking changes), return no calls and explain in note.`;
}

const PlanSchema = z.strictObject({
  calls: z.array(z.strictObject({ tool: z.string(), argumentsJson: z.string() })),
  note: z.string().nullable(),
});

const COMPOSER_SYSTEM = `You are the AI Command Center for a travel company's employees.
Input JSON: request, note (may be null), results (tool outputs from the company database; the ONLY facts you may use).
Write:
- answer: a concise, specific response (max 140 words). Mention names, counts and amounts from the results. Say clearly when data is demo data or when a tool failed. Never claim an action was completed unless a result has status "completed" for a write tool; proposed actions are awaiting the employee's approval.
- nextSteps: 1–3 concrete suggestions.
Never invent records, prices, policies or bookings.`;

const ComposeSchema = z.strictObject({ answer: z.string(), nextSteps: z.array(z.string()) });

function loadConversation(actor: Actor, conversationId?: string | null) {
  if (conversationId) {
    const conv = getConversation(conversationId);
    if (!conv || conv.kind !== "copilot") throw notFound("Conversation not found");
    if (conv.user_id !== actor.userId) throw forbidden();
    return conv;
  }
  return latestConversationForOwner(actor, "copilot") ?? createConversation(actor, "copilot");
}

function compact(value: unknown, max = 2500): unknown {
  const s = JSON.stringify(value ?? null);
  return s.length <= max ? value : `${s.slice(0, max)}…(truncated)`;
}

async function plan(actor: Actor, message: string, context: CommandContext): Promise<{ plan: CommandPlan; source: CommandResponse["ai"]["planner"]; notice: string | null }> {
  const routed = routeCommand(message, context);
  if (routed.confidence === "high") return { plan: routed, source: "rules", notice: null };
  const allowed = toolsFor({ actor }, "employee");
  const outcome = await runStructured({
    actorKey: actor.key,
    category: "copilot",
    tier: "routine",
    system: plannerSystem(toolCatalog(allowed)),
    input: JSON.stringify({ request: message.slice(0, 1000), context, today: new Date().toISOString().slice(0, 10) }),
    schema: PlanSchema,
    schemaName: "command_plan",
    maxOutputTokens: 400,
    fallback: () => ({ calls: routed.calls.map((c) => ({ tool: c.tool, argumentsJson: JSON.stringify(c.args) })), note: routed.note ?? null }),
  });
  const calls: PlannedCall[] = [];
  for (const c of outcome.value.calls.slice(0, MAX_CALLS)) {
    try {
      calls.push({ tool: c.tool, args: JSON.parse(c.argumentsJson || "{}") });
    } catch {
      calls.push({ tool: c.tool, args: { __invalid: c.argumentsJson } });
    }
  }
  const source = outcome.source === "live" ? "live" : outcome.source === "mock" ? "rules" : "fallback";
  return { plan: { ...routed, calls: calls.length || outcome.value.note ? calls : routed.calls, note: outcome.value.note ?? routed.note }, source, notice: outcome.notice };
}

const fmtList = (items: string[]) => items.map((i) => `• ${i}`).join("\n");

/** Deterministic answer used in mock mode and as the composer fallback. */
export function composeDeterministic(p: CommandPlan, results: ToolExecution[]): { answer: string; nextSteps: string[] } {
  const parts: string[] = [];
  if (p.note) parts.push(p.note);
  const next: string[] = [];
  for (const r of results) {
    parts.push(r.status === "failed" ? (r.error === "forbidden" ? r.summary : `⚠ ${r.tool}: ${r.summary}`) : r.status === "proposed" ? `Awaiting your approval: ${r.summary}` : r.summary);
    const d = r.data as Record<string, unknown> | unknown[] | undefined;
    if (r.status !== "completed" || !d) continue;
    if (r.tool === "find_stalled_leads" && Array.isArray(d)) {
      parts.push(fmtList((d as { name: string; destination: string | null; stage: string; value: number | null; owner: string | null }[]).slice(0, 5).map((l) => `${l.name} — ${l.destination ?? "?"}, ${l.stage.replace("_", " ")}${l.value ? `, ${formatMoney(l.value)} est.` : ""}${l.owner ? ` (owner: ${l.owner})` : ""}`)));
      next.push("Attach the highest-value lead and ask me to prepare a follow-up.");
    }
    if (r.tool === "find_urgent_support_cases" && Array.isArray(d)) {
      parts.push(fmtList((d as { ref: string; subject: string; reason: string; assignee: string }[]).slice(0, 5).map((t) => `${t.ref} ${t.subject} — ${t.reason} (${t.assignee})`)));
      if ((d as { assignee: string }[]).some((t) => t.assignee === "Unassigned")) next.push("Assign the unowned cases — open one and ask me to assign it to you.");
    }
    if (r.tool === "find_over_budget_trips" && Array.isArray(d)) {
      parts.push(fmtList((d as { trip: string; customer: string | null; estimate: number; budget: number; overPct: number }[]).slice(0, 5).map((t) => `${t.trip}${t.customer ? ` (${t.customer})` : ""}: ${formatMoney(t.estimate)} vs budget ${formatMoney(t.budget)} (+${t.overPct}%)`)));
      next.push("Offer these customers a cheaper hotel level or fewer paid activities.");
    }
    if (r.tool === "get_operational_exceptions" && Array.isArray(d)) {
      parts.push(fmtList((d as { severity: string; title: string; detail: string }[]).slice(0, 6).map((e) => `${e.severity === "high" ? "HIGH" : "Medium"} — ${e.title}: ${e.detail}`)));
    }
    if (r.tool === "get_lead_summary") {
      const s = d as { requirements: string | null; itinerary: { days: number; total: number; budgetStatus: string } | null; pendingFollowUps: unknown[]; lastCustomerMessages: string[] };
      if (s.requirements) parts.push(`Requirements: ${s.requirements}`);
      if (s.itinerary) parts.push(`Itinerary: ${s.itinerary.days} days, ${formatMoney(s.itinerary.total)} estimated (${s.itinerary.budgetStatus} budget).`);
      if (s.lastCustomerMessages.length) parts.push(`Customer said: “${s.lastCustomerMessages.slice(-2).join("” / “")}”`);
      next.push(s.pendingFollowUps.length ? "A follow-up is already pending — keep that commitment." : "Ask me to prepare a follow-up for this lead.");
    }
    if (r.tool === "search_company_knowledge" && Array.isArray(d)) {
      for (const doc of (d as { title: string; text: string }[]).slice(0, 2)) parts.push(`From “${doc.title}”: ${doc.text.slice(0, 400)}`);
    }
    if (r.tool === "get_business_metrics") {
      const m = d as { kpis: Record<string, number>; conversion: { leadToBookingRequestPct: number; leadToWonPct: number } };
      parts.push(`New leads (7d): ${m.kpis.newLeads} · Active plans: ${m.kpis.activeTripPlans} · Open handoffs: ${m.kpis.bookingHandoffsOpen} · Open tickets: ${m.kpis.openTickets} · Follow-ups due: ${m.kpis.followUpsDue} · Lead→booking request ${m.conversion.leadToBookingRequestPct}%.`);
    }
  }
  if (results.some((r) => r.status === "proposed")) next.unshift("Review the proposed action below and approve or reject it.");
  if (!results.length && !p.note) parts.push("I couldn't match that to a business tool. Try asking about leads, customers, trips, bookings, support cases or policies.");
  return { answer: parts.join("\n\n"), nextSteps: next.slice(0, 3) };
}

export async function commandChat(actor: Actor, input: { message: string; conversationId?: string | null; context?: CommandContext }): Promise<CommandResponse> {
  const conv = loadConversation(actor, input.conversationId);
  const context = input.context ?? {};
  addMessage(conv.id, "user", input.message, { context });

  const { plan: p, source: plannerSource, notice } = await plan(actor, input.message, context);
  const ctx = { actor, source: "command_center" as const, conversationId: conv.id };
  const results: ToolExecution[] = [];
  let draft: string | null = null;
  for (const call of p.calls.slice(0, MAX_CALLS)) {
    const args = { ...call.args };
    if (args.message === DRAFT_PLACEHOLDER) {
      if (!draft) continue;
      args.message = draft;
    }
    const r = await executeTool(ctx, call.tool, args);
    if (call.tool === "draft_follow_up_message" && r.status === "completed") draft = (r.data as { draft: string }).draft;
    results.push(r);
  }

  const deterministic = () => composeDeterministic(p, results);
  let composerSource: CommandResponse["ai"]["composer"] = "rules";
  let composed = deterministic();
  const hasData = results.some((r) => r.status === "completed" && r.kind === "read" && r.tool !== "draft_follow_up_message");
  if (hasData && plannerSource !== "fallback") {
    const out = await runStructured({
      actorKey: actor.key,
      category: "copilot",
      tier: "routine",
      system: COMPOSER_SYSTEM,
      input: JSON.stringify({ request: input.message.slice(0, 600), note: p.note ?? null, results: results.map((r) => ({ tool: r.tool, kind: r.kind, status: r.status, summary: r.summary, data: compact(r.data) })) }),
      schema: ComposeSchema,
      schemaName: "command_answer",
      maxOutputTokens: 450,
      fallback: deterministic,
    });
    composed = out.value;
    composerSource = out.source === "live" ? "live" : out.source === "mock" ? "rules" : "fallback";
  }

  const records = dedupe(results.flatMap((r) => r.records));
  const response: CommandResponse = {
    conversationId: conv.id,
    answer: composed.answer,
    nextSteps: composed.nextSteps,
    draft,
    toolCalls: results,
    records,
    pendingActions: results.filter((r) => r.status === "proposed"),
    ai: { planner: plannerSource, composer: composerSource, notice },
  };
  addMessage(conv.id, "assistant", response.answer, {
    nextSteps: response.nextSteps,
    draft,
    toolCalls: results.map((r) => ({ ...r, data: undefined })),
    records,
    ai: response.ai,
  });
  return response;
}

function dedupe(records: RecordRef[]): RecordRef[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const k = `${r.type}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Command Center queues. Every list is a database query, filtered by the employee's permissions. */
export function commandOverview(actor: Actor) {
  const r = actor.role;
  const leads = can(r, "leads:read");
  const tickets = can(r, "tickets:read");
  const trips = can(r, "trips:read_all");
  const exceptions = operationalExceptions().filter((e) =>
    e.type === "urgent_ticket" ? tickets : e.type.includes("handoff") ? trips : e.type === "overdue_follow_up" ? leads : true,
  );
  const queues = {
    approvals: listAiActions({ status: "pending", actorUserId: r === "admin" ? undefined : (actor.userId ?? "-"), limit: 20 }),
    exceptions,
    stalledLeads: leads ? stalledLeads(8) : null,
    followUpsDue: leads ? followUpsDue(8) : null,
    urgentSupport: tickets ? urgentSupportCases(8) : null,
    handoffs: trips ? handoffsNeedingAction(8) : null,
    tripsAwaitingReview: trips ? tripsAwaitingReview(8) : null,
    activeConversations: trips || tickets ? activeConversations(8) : null,
    overBudget: trips ? overBudgetTrips(5) : null,
    recentActions: listAiActions({ limit: 15 }),
  };
  return { queues };
}

export function commandHistory(actor: Actor) {
  const conv = latestConversationForOwner(actor, "copilot");
  if (!conv) return { conversationId: null, messages: [], actions: [] };
  return {
    conversationId: conv.id,
    messages: listMessages(conv.id).slice(-30),
    actions: listAiActions({ conversationId: conv.id, kind: "write", limit: 50 }),
  };
}
