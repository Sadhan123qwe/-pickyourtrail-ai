import "server-only";
import { z } from "zod";
import { all } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import { runStructured } from "@/lib/ai/run";
import { formatMoney } from "@/lib/planner/profile";
import { LEAD_STAGES, LEAD_STAGE_LABELS, TICKET_CATEGORY_LABELS, canTransitionLead, canTransitionTicket } from "@/lib/workflows/rules";
import { getLead, leadPreferencesSummary, listFollowUps, listLeadActivities, addFollowUp, updateLead, addLeadActivity, type LeadListItem } from "@/lib/repos/leads";
import { getTicket, listTicketMessages, updateTicket } from "@/lib/repos/tickets";
import { searchKnowledge } from "@/lib/repos/knowledge";
import { analyticsReport, dashboardOverview, defaultRange } from "@/lib/repos/metrics";
import { getUser } from "@/lib/repos/users";
import { latestItineraryForTrip } from "@/lib/repos/itineraries";
import { findConversationForTrip, listMessages } from "@/lib/repos/conversations";
import { customerKeyForLead, getCustomer, listCustomers } from "@/lib/repos/customers";
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
import { defineTool, ToolError, type RecordRef } from "./types";

const leadRef = (l: { id: string; name: string; destination?: string | null }): RecordRef => ({
  type: "lead",
  id: l.id,
  label: `${l.name}${l.destination ? ` · ${l.destination}` : ""}`,
  href: `/admin/leads?lead=${l.id}`,
});
const ticketRef = (t: { id: string; ref: string; subject: string }): RecordRef => ({ type: "ticket", id: t.id, label: `${t.ref} · ${t.subject}`, href: `/admin/support?ticket=${t.id}` });
const tripRef = (t: { id: string; title: string }): RecordRef => ({ type: "trip", id: t.id, label: t.title, href: `/admin/trips?trip=${t.id}` });

const id = z.string().min(3).max(64);
const limit = z.number().int().min(1).max(25).optional();

/** Resolves a lead by id, or by a (partial) customer name. */
function resolveLead(args: { leadId?: string; nameQuery?: string }): LeadListItem {
  if (args.leadId) {
    const lead = getLead(args.leadId);
    if (!lead) throw new ToolError("Lead not found", "not_found");
    return lead;
  }
  if (args.nameQuery) {
    const matches = all<{ id: string }>("SELECT id FROM leads WHERE name LIKE ? ORDER BY (stage IN ('won','lost')), updated_at DESC LIMIT 2", [`%${args.nameQuery}%`]);
    if (!matches.length) throw new ToolError(`No lead matches “${args.nameQuery}”`, "not_found");
    return getLead(matches[0].id)!;
  }
  throw new ToolError("Specify a lead (attach one or name the customer)", "invalid_arguments");
}

function resolveTicket(args: { ticketId?: string; ref?: string }) {
  const ticket = args.ticketId
    ? getTicket(args.ticketId)
    : args.ref
      ? (() => {
          const r = all<{ id: string }>("SELECT id FROM support_tickets WHERE ref = ? COLLATE NOCASE", [args.ref.trim()]);
          return r[0] ? getTicket(r[0].id) : undefined;
        })()
      : undefined;
  if (!ticket) throw new ToolError("Ticket not found", "not_found");
  return ticket;
}

function resolveAssignee(actorId: string | null, assigneeId: string, roles: string[]) {
  const userId = assigneeId === "me" ? actorId : assigneeId;
  const user = userId ? getUser(userId) : undefined;
  if (!user || !roles.includes(user.role)) throw new ToolError("Assignee must be an employee with the right role", "invalid_arguments");
  return user;
}

function nextMorning(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(4, 30, 0, 0); // 10:00 IST
  return d.toISOString();
}

const leadTarget = z.object({ leadId: id.optional(), nameQuery: z.string().min(2).max(60).optional() });

export const employeeTools = [
  defineTool({
    name: "find_stalled_leads",
    description: "Open leads whose customer generated an itinerary but has not requested a booking.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ limit }),
    authorize: (a) => can(a.role, "leads:read"),
    run: (_ctx, args) => {
      const rows = stalledLeads(args.limit ?? 10);
      return {
        summary: rows.length ? `${rows.length} open lead${rows.length > 1 ? "s" : ""} planned a trip but haven't requested a booking.` : "No stalled leads: every lead with an itinerary has moved to a booking request.",
        records: rows.map((r) => leadRef(r)),
        data: rows.map((r) => ({ id: r.id, name: r.name, destination: r.destination, stage: r.stage, value: r.estimated_value, owner: r.assignee_name, tripStatus: r.trip_status, lastActivity: r.last_activity_at, demo: !!r.is_demo })),
      };
    },
  }),
  defineTool({
    name: "get_lead_summary",
    description: "Customer requirements, itinerary, sales stage, follow-ups and recent activity for one lead.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: leadTarget,
    authorize: (a) => can(a.role, "leads:read"),
    run: (_ctx, args) => {
      const lead = resolveLead(args);
      const prefs = leadPreferencesSummary(lead);
      const itinerary = lead.trip_id ? latestItineraryForTrip(lead.trip_id) : undefined;
      const conv = lead.trip_id ? findConversationForTrip(lead.trip_id, "planner") : undefined;
      const lastCustomerMessages = conv
        ? listMessages(conv.id)
            .filter((m) => m.role === "user")
            .slice(-4)
            .map((m) => m.content.slice(0, 200))
        : [];
      const pending = listFollowUps(lead.id).filter((f) => f.status === "pending");
      const records: RecordRef[] = [leadRef(lead)];
      if (lead.trip_id && itinerary) records.push({ type: "itinerary", id: itinerary.id, label: `Itinerary v${itinerary.version} · ${formatMoney(itinerary.budget.total)} est.`, href: `/admin/trips?trip=${lead.trip_id}` });
      return {
        summary: `${lead.name}: ${LEAD_STAGE_LABELS[lead.stage]} lead for ${lead.destination ?? "an undecided destination"}, score ${lead.score}/100${lead.estimated_value ? `, estimated value ${formatMoney(lead.estimated_value)}` : ""}.`,
        records,
        data: {
          lead: { id: lead.id, name: lead.name, email: lead.email, stage: lead.stage, score: lead.score, owner: lead.assignee_name, source: lead.source, estimatedValue: lead.estimated_value, demo: !!lead.is_demo },
          requirements: prefs,
          itinerary: itinerary ? { version: itinerary.version, days: itinerary.days.length, total: itinerary.budget.total, budgetStatus: itinerary.budget.comparison.status, summary: itinerary.summary } : null,
          conversationSummary: conv?.summary ?? null,
          lastCustomerMessages,
          pendingFollowUps: pending.map((f) => ({ channel: f.channel, due: f.due_at, note: f.note })),
          recentActivity: listLeadActivities(lead.id).slice(0, 4).map((a) => a.body.slice(0, 160)),
        },
      };
    },
  }),
  defineTool({
    name: "get_customer_context",
    description: "Everything about one customer: trips, leads, support tickets and conversation summaries.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ customerKey: z.string().max(80).optional(), leadId: id.optional(), nameQuery: z.string().min(2).max(60).optional() }),
    authorize: (a) => can(a.role, "leads:read") || can(a.role, "tickets:read"),
    run: (ctx, args) => {
      let key = args.customerKey ?? null;
      if (!key && (args.leadId || args.nameQuery)) {
        if (args.leadId || can(ctx.actor.role, "leads:read")) {
          try {
            key = customerKeyForLead(resolveLead(args));
          } catch {
            key = null;
          }
        }
        if (!key && args.nameQuery) key = listCustomers({ q: args.nameQuery, limit: 1, offset: 0 }).items[0]?.key ?? null;
      }
      const c = key ? getCustomer(key) : undefined;
      if (!c) throw new ToolError("Customer not found", "not_found");
      const showLeads = can(ctx.actor.role, "leads:read");
      const showTickets = can(ctx.actor.role, "tickets:read");
      const records: RecordRef[] = [{ type: "customer", id: c.customer.key, label: c.customer.name, href: `/admin/customers?customer=${encodeURIComponent(c.customer.key)}` }];
      for (const t of c.trips.slice(0, 3)) records.push(tripRef(t));
      if (showTickets) for (const t of c.tickets.slice(0, 3)) records.push(ticketRef(t));
      return {
        summary: `${c.customer.name} (${c.customer.kind}): ${c.trips.length} trip(s), ${showLeads ? `${c.leads.length} lead(s), ` : ""}${showTickets ? `${c.tickets.filter((t) => !["resolved", "closed"].includes(t.status)).length} open ticket(s)` : ""}.`,
        records,
        data: {
          customer: { name: c.customer.name, email: c.customer.email, kind: c.customer.kind },
          trips: c.trips.slice(0, 5),
          leads: showLeads ? c.leads.slice(0, 5) : "hidden (no permission)",
          tickets: showTickets ? c.tickets.slice(0, 5) : "hidden (no permission)",
          conversations: c.conversations.slice(0, 3).map((x) => ({ kind: x.kind, summary: x.summary, messages: x.messages, updated: x.updated_at })),
        },
      };
    },
  }),
  defineTool({
    name: "find_urgent_support_cases",
    description: "Support tickets needing urgent attention: urgent, escalated, or high priority without a first response.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ limit }),
    authorize: (a) => can(a.role, "tickets:read"),
    run: (_ctx, args) => {
      const rows = urgentSupportCases(args.limit ?? 10);
      return {
        summary: rows.length ? `${rows.length} support case${rows.length > 1 ? "s" : ""} need attention (${rows.filter((r) => r.priority === "urgent").length} urgent).` : "No support cases currently need urgent attention.",
        records: rows.map(ticketRef),
        data: rows.map((r) => ({ ref: r.ref, subject: r.subject, priority: r.priority, status: r.status, reason: r.reason, assignee: r.assignee_name ?? "Unassigned", opened: r.created_at })),
      };
    },
  }),
  defineTool({
    name: "get_ticket_summary",
    description: "Details and message history for one support ticket.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ ticketId: id.optional(), ref: z.string().max(20).optional() }),
    authorize: (a) => can(a.role, "tickets:read"),
    run: (ctx, args) => {
      const t = resolveTicket(args);
      const msgs = listTicketMessages(t.id, can(ctx.actor.role, "tickets:write")).slice(-5);
      return {
        summary: `${t.ref} is ${t.status.replace(/_/g, " ")} with ${t.priority} priority (${TICKET_CATEGORY_LABELS[t.category].toLowerCase()}), ${t.assignee_name ? `assigned to ${t.assignee_name}` : "unassigned"}.`,
        records: [ticketRef(t)],
        data: { ref: t.ref, subject: t.subject, status: t.status, priority: t.priority, customer: t.customer_name ?? t.contact_email, trip: t.trip_title, messages: msgs.map((m) => `${m.author_type}: ${m.body.slice(0, 200)}`) },
      };
    },
  }),
  defineTool({
    name: "find_over_budget_trips",
    description: "Trips whose latest itinerary estimate exceeds the customer's stated budget.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ limit }),
    authorize: (a) => can(a.role, "trips:read_all"),
    run: (_ctx, args) => {
      const rows = overBudgetTrips(args.limit ?? 10);
      return {
        summary: rows.length ? `${rows.length} trip${rows.length > 1 ? "s" : ""} are over the customer's stated budget (estimates computed from the itinerary).` : "No active trip exceeds its stated budget.",
        records: rows.map((r) => tripRef({ id: r.trip_id, title: r.title })),
        data: rows.map((r) => ({ trip: r.title, customer: r.customer, estimate: r.total, budget: r.budget_inr, overBy: r.over_by, overPct: r.over_pct, status: r.status })),
      };
    },
  }),
  defineTool({
    name: "get_operational_exceptions",
    description: "Today's operational exceptions: urgent tickets, failed or stale booking handoffs, overdue follow-ups, AI failures.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({}),
    authorize: (a) => can(a.role, "dashboard:read"),
    run: (ctx) => {
      const r = ctx.actor.role;
      const items = operationalExceptions().filter((e) =>
        e.type === "urgent_ticket" ? can(r, "tickets:read") : e.type.includes("handoff") ? can(r, "trips:read_all") : e.type === "overdue_follow_up" ? can(r, "leads:read") : true,
      );
      const records: RecordRef[] = items
        .filter((e) => e.entityId && (e.type === "urgent_ticket" || e.type.includes("handoff")))
        .slice(0, 8)
        .map((e) => (e.type === "urgent_ticket" ? { type: "ticket" as const, id: e.entityId!, label: e.title, href: `/admin/support?ticket=${e.entityId}` } : { type: "handoff" as const, id: e.entityId!, label: e.title, href: `/admin/bookings?handoff=${e.entityId}` }));
      return {
        summary: items.length ? `${items.length} operational exception${items.length > 1 ? "s" : ""} (${items.filter((i) => i.severity === "high").length} high severity).` : "No operational exceptions today.",
        records,
        data: items.slice(0, 12).map((i) => ({ type: i.type, severity: i.severity, title: i.title, detail: i.detail })),
      };
    },
  }),
  defineTool({
    name: "get_business_metrics",
    description: "Key business metrics from stored records: leads, conversion, trips, handoffs, support backlog, satisfaction.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ days: z.number().int().min(1).max(365).optional() }),
    authorize: (a) => can(a.role, "dashboard:read"),
    run: (_ctx, args) => {
      const o = dashboardOverview();
      const r = analyticsReport(defaultRange(args.days ?? 30));
      return {
        summary: `${r.leadConversion.leads} leads in the last ${args.days ?? 30} days, ${r.leadConversion.leadToBookingRequestPct}% reached a booking request; ${o.kpis.openTickets} open tickets.`,
        records: [{ type: "metric", id: "overview", label: "Business overview", href: "/admin" }],
        data: { kpis: o.kpis, conversion: r.leadConversion, planning: r.planningCompletion, support: { ...r.support, byPriority: undefined }, csat: r.satisfaction, avgEstimatedTripValue: r.avgEstimatedTripValue, records: o.data },
      };
    },
  }),
  defineTool({
    name: "get_pending_operations",
    description: "Counts and top items of every work queue: follow-ups due, stalled leads, trips awaiting review, handoffs, urgent tickets.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({}),
    authorize: (a) => can(a.role, "dashboard:read"),
    run: (ctx) => {
      const r = ctx.actor.role;
      const data: Record<string, unknown> = {};
      if (can(r, "leads:read")) {
        data.followUpsDue = followUpsDue(5);
        data.stalledLeads = stalledLeads(5).map((l) => ({ name: l.name, destination: l.destination, stage: l.stage }));
      }
      if (can(r, "trips:read_all")) {
        data.tripsAwaitingReview = tripsAwaitingReview(5);
        data.handoffs = handoffsNeedingAction(5);
      }
      if (can(r, "tickets:read")) data.urgentTickets = urgentSupportCases(5).map((t) => ({ ref: t.ref, subject: t.subject, reason: t.reason }));
      data.activeConversations = activeConversations(5).length;
      const counts = Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : v}`);
      return { summary: `Work queues — ${counts.join(", ")}.`, records: [{ type: "metric", id: "command", label: "AI Command Center queues", href: "/admin/command-center" }], data };
    },
  }),
  defineTool({
    name: "search_company_knowledge",
    description: "Search approved company documents (policies, SOPs, playbooks). Use for any policy or procedure question.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ query: z.string().min(2).max(300) }),
    authorize: (a) => can(a.role, "copilot:use"),
    run: (ctx, args) => {
      const hits = searchKnowledge(args.query, { includeInternal: can(ctx.actor.role, "knowledge:read_internal"), limit: 3 });
      return {
        summary: hits.length ? `Found ${hits.length} approved document${hits.length > 1 ? "s" : ""}.` : "No approved document covers this; I won't guess.",
        records: hits.map((h) => ({ type: "document" as const, id: h.id, label: `${h.title}${h.isDemo ? " (demo)" : ""}`, href: `/admin/knowledge?doc=${h.id}` })),
        data: hits.map((h) => ({ title: h.title, audience: h.audience, text: h.snippet })),
      };
    },
  }),
  defineTool({
    name: "draft_follow_up_message",
    description: "Write a follow-up message for a lead, grounded in their trip details. Drafting only — nothing is sent.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: leadTarget.extend({ channel: z.enum(["email", "whatsapp", "call"]).optional() }),
    authorize: (a) => can(a.role, "leads:read"),
    run: async (ctx, args) => {
      const lead = resolveLead(args);
      const prefs = leadPreferencesSummary(lead);
      const first = lead.name.split(" ")[0];
      const employee = ctx.actor.user?.name ?? "the Pickyourtrail team";
      const template = () => ({
        draft: `Hi ${first}, thanks for planning your ${lead.destination ?? "trip"} with us! I've looked at the itinerary you created${lead.travel_month ? ` for ${lead.travel_month}` : ""} and would love to help fine-tune it — hotels, activities or dates. Do you have 10 minutes for a quick call this week? I'll confirm exact prices and availability once we lock the details.\n\nBest,\n${employee}`,
      });
      const out = await runStructured({
        actorKey: ctx.actor.key,
        category: "copilot",
        tier: "routine",
        system:
          "You write short, warm sales follow-up messages for a travel company. Use only the given facts. Never promise prices, availability, discounts or confirmed bookings. Max 90 words. Sign with the employee's name.",
        input: JSON.stringify({ customerFirstName: first, destination: lead.destination, stage: lead.stage, requirements: prefs, channel: args.channel ?? "whatsapp", employee }),
        schema: z.strictObject({ draft: z.string() }),
        schemaName: "follow_up_draft",
        maxOutputTokens: 300,
        fallback: template,
      });
      return {
        summary: `Drafted a ${args.channel ?? "WhatsApp"} follow-up for ${lead.name}${out.source === "live" ? "" : " (template — live AI not used)"}. Not sent.`,
        records: [leadRef(lead)],
        data: { leadId: lead.id, draft: out.value.draft, aiSource: out.source },
      };
    },
  }),
  defineTool({
    name: "find_follow_ups_due",
    description: "Sales follow-ups due today or overdue (optionally only the employee's own leads).",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ mine: z.boolean().optional(), limit }),
    authorize: (a) => can(a.role, "leads:read"),
    run: (ctx, args) => {
      const rows = followUpsDue(args.limit ?? 15).filter((f) => !args.mine || f.assignee_name === ctx.actor.user?.name);
      const overdue = rows.filter((r) => r.overdue).length;
      return {
        summary: rows.length ? `${rows.length} follow-up${rows.length > 1 ? "s" : ""} due today or earlier (${overdue} overdue).` : "No follow-ups are due today.",
        records: rows.map((r) => ({ type: "lead" as const, id: r.lead_id, label: `${r.lead_name} · ${r.channel}`, href: `/admin/leads?lead=${r.lead_id}` })),
        data: rows.map((r) => ({ lead: r.lead_name, channel: r.channel, due: r.due_at, overdue: !!r.overdue, owner: r.assignee_name, note: r.note })),
      };
    },
  }),
  defineTool({
    name: "find_my_open_tickets",
    description: "Unresolved support tickets assigned to the current employee.",
    audience: "employee",
    kind: "read",
    requiresConfirmation: false,
    args: z.object({ limit }),
    authorize: (a) => can(a.role, "tickets:read"),
    run: (ctx, args) => {
      const rows = all<{ id: string; ref: string; subject: string; priority: string; status: string; created_at: string; first_response_at: string | null }>(
        "SELECT id, ref, subject, priority, status, created_at, first_response_at FROM support_tickets WHERE assigned_to = ? AND status NOT IN ('resolved','closed') ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at LIMIT ?",
        [ctx.actor.userId ?? "-", args.limit ?? 15],
      );
      return {
        summary: rows.length ? `You have ${rows.length} unresolved case${rows.length > 1 ? "s" : ""}.` : "You have no unresolved cases assigned to you.",
        records: rows.map(ticketRef),
        data: rows.map((r) => ({ ref: r.ref, subject: r.subject, priority: r.priority, status: r.status, awaitingFirstResponse: !r.first_response_at })),
      };
    },
  }),
  // ---------------------------------------------------------------- writes
  defineTool({
    name: "schedule_follow_up",
    description: "Create a follow-up task on a lead with the prepared message. Records the task only; it does NOT send anything to the customer.",
    audience: "employee",
    kind: "write",
    requiresConfirmation: true,
    args: z.object({ leadId: id, channel: z.enum(["call", "email", "whatsapp", "meeting"]).default("whatsapp"), dueAt: z.iso.datetime().optional(), message: z.string().min(5).max(1500) }),
    authorize: (a) => can(a.role, "leads:write"),
    describe: (_ctx, args) => {
      const lead = resolveLead({ leadId: args.leadId });
      const due = args.dueAt ?? nextMorning();
      return {
        description: `Schedule a ${args.channel} follow-up for ${lead.name} on ${new Date(due).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST with the prepared message. Nothing is sent to the customer — there is no messaging integration in this build.`,
        records: [leadRef(lead)],
      };
    },
    run: (ctx, args) => {
      const lead = resolveLead({ leadId: args.leadId });
      const user = ctx.actor.user!;
      const fu = addFollowUp({ userId: user.id, label: user.name }, lead.id, { dueAt: args.dueAt ?? nextMorning(), channel: args.channel, note: args.message.slice(0, 500) });
      addLeadActivity(lead.id, user.id, "follow_up_prepared", `Follow-up message prepared with the AI Command Center (not sent): “${args.message.slice(0, 300)}”`);
      return { summary: `Follow-up scheduled for ${lead.name} (${args.channel}, due ${fu.due_at.slice(0, 16).replace("T", " ")} UTC). Message saved on the task; not sent.`, records: [leadRef(lead), { type: "follow_up", id: fu.id, label: `Follow-up · ${args.channel}`, href: `/admin/leads?lead=${lead.id}` }] };
    },
  }),
  defineTool({
    name: "update_lead_stage",
    description: "Move a lead to another sales stage (state machine enforced; 'lost' needs a reason).",
    audience: "employee",
    kind: "write",
    requiresConfirmation: true,
    args: z.object({ leadId: id, stage: z.enum(LEAD_STAGES), lostReason: z.string().max(200).optional() }),
    authorize: (a) => can(a.role, "leads:write"),
    describe: (_ctx, args) => {
      const lead = resolveLead({ leadId: args.leadId });
      if (!canTransitionLead(lead.stage, args.stage)) throw new ToolError(`A lead can't move from ${lead.stage} to ${args.stage}`, "invalid_arguments");
      if (args.stage === "lost" && !args.lostReason) throw new ToolError("A reason is required to mark a lead as lost", "invalid_arguments");
      return { description: `Move ${lead.name} from ${LEAD_STAGE_LABELS[lead.stage]} to ${LEAD_STAGE_LABELS[args.stage]}.`, records: [leadRef(lead)] };
    },
    run: (ctx, args) => {
      const user = ctx.actor.user!;
      const lead = updateLead({ userId: user.id, label: user.name }, args.leadId, { stage: args.stage, lostReason: args.lostReason ?? null });
      return { summary: `${lead.name} is now ${LEAD_STAGE_LABELS[lead.stage]}.`, records: [leadRef(lead)] };
    },
  }),
  defineTool({
    name: "assign_ticket",
    description: "Assign a support ticket to an agent ('me' for the current employee).",
    audience: "employee",
    kind: "write",
    requiresConfirmation: true,
    args: z.object({ ticketId: id, assigneeId: z.string().min(2).max(64) }),
    authorize: (a) => can(a.role, "tickets:write"),
    describe: (ctx, args) => {
      const t = resolveTicket({ ticketId: args.ticketId });
      const user = resolveAssignee(ctx.actor.userId, args.assigneeId, ["support", "admin"]);
      return { description: `Assign ${t.ref} (“${t.subject}”) to ${user.name}.`, records: [ticketRef(t)] };
    },
    run: (ctx, args) => {
      const user = resolveAssignee(ctx.actor.userId, args.assigneeId, ["support", "admin"]);
      const t = updateTicket({ userId: ctx.actor.userId, label: ctx.actor.user!.name }, args.ticketId, { assignedTo: user.id });
      return { summary: `${t.ref} assigned to ${user.name}.`, records: [ticketRef(t)] };
    },
  }),
  defineTool({
    name: "escalate_ticket",
    description: "Escalate a support ticket to the escalation queue with a reason.",
    audience: "employee",
    kind: "write",
    requiresConfirmation: true,
    args: z.object({ ticketId: id, reason: z.string().min(3).max(300) }),
    authorize: (a) => can(a.role, "tickets:write"),
    describe: (_ctx, args) => {
      const t = resolveTicket({ ticketId: args.ticketId });
      if (t.status !== "escalated" && !canTransitionTicket(t.status, "escalated")) throw new ToolError(`A ${t.status} ticket can't be escalated`, "invalid_arguments");
      return { description: `Escalate ${t.ref} (“${t.subject}”): ${args.reason}`, records: [ticketRef(t)] };
    },
    run: (ctx, args) => {
      const t = updateTicket({ userId: ctx.actor.userId, label: ctx.actor.user!.name }, args.ticketId, { escalate: true, escalationReason: args.reason });
      return { summary: `${t.ref} escalated.`, records: [ticketRef(t)] };
    },
  }),
];

// Alias with the name used in the platform brief; same validation, authorization and data.
const customerContextTool = employeeTools.find((t) => t.name === "get_customer_context");
if (customerContextTool) employeeTools.push({ ...customerContextTool, name: "get_authorized_customer_context", description: "Authorized customer context (alias of get_customer_context)." } as (typeof employeeTools)[number]);
