import { LEAD_STAGES } from "@/lib/workflows/rules";

/**
 * Deterministic intent router for the AI Command Center. When it is confident
 * the plan is used directly (no planning call to the model); otherwise it is
 * the fallback when the model is unavailable.
 */

export interface CommandContext {
  leadId?: string | null;
  ticketId?: string | null;
  customerKey?: string | null;
}

export interface PlannedCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface CommandPlan {
  intent:
    | "stalled_leads"
    | "lead_summary"
    | "customer_summary"
    | "urgent_support"
    | "follow_up"
    | "over_budget"
    | "exceptions"
    | "metrics"
    | "pending"
    | "ticket_summary"
    | "assign_ticket"
    | "escalate_ticket"
    | "lead_stage"
    | "knowledge"
    | "follow_ups_due"
    | "my_tickets"
    | "not_available";
  calls: PlannedCall[];
  confidence: "high" | "low";
  /** Honest note when a request can't be fulfilled by any tool. */
  note?: string;
}

/** Placeholder a write call may use to reference the draft produced earlier in the same plan. */
export const DRAFT_PLACEHOLDER = "{{draft}}";

function nameQuery(text: string): string | null {
  const quoted = /["“']([^"”']{2,60})["”']/.exec(text)?.[1];
  if (quoted) return quoted.trim();
  const m = /\b(?:for|about|of|to|summari[sz]e)\s+(?:the\s+)?(?:lead\s+|customer\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/.exec(text);
  return m && !/^(This|That|The|Today|Me|My|All|Each|Every)$/.test(m[1].split(" ")[0]) ? m[1] : null;
}

export function routeCommand(message: string, ctx: CommandContext = {}): CommandPlan {
  const text = message.toLowerCase();
  const leadTarget = ctx.leadId ? { leadId: ctx.leadId } : nameQuery(message) ? { nameQuery: nameQuery(message)! } : null;
  const ticketRef = /\bpyt-\d+\b/i.exec(message)?.[0]?.toUpperCase();
  const ticketTarget = ctx.ticketId ? { ticketId: ctx.ticketId } : ticketRef ? { ref: ticketRef } : null;

  // Things no tool can do: be explicit instead of pretending.
  if (/\b(send|email|whatsapp|message)\b.*\b(now|immediately|right away)\b|\bsend (it|the message|the follow[- ]?up)\b/.test(text)) {
    return {
      intent: "not_available",
      calls: leadTarget ? [{ tool: "draft_follow_up_message", args: { ...leadTarget } }] : [],
      confidence: "high",
      note: "Sending messages isn't connected in this build, so I can't send anything to customers. I can prepare the message and schedule a follow-up task for you to send.",
    };
  }
  if (/\b(refund|cancel (the |their |this )?booking|change (the |their )?booking|confirm (the |a )?booking|issue a refund)\b/.test(text)) {
    return {
      intent: "not_available",
      calls: [{ tool: "search_company_knowledge", args: { query: message.slice(0, 200) } }],
      confidence: "high",
      note: "Refunds and booking changes must be handled by a person in the booking system after checking supplier terms. I can't issue refunds or change bookings, and I won't report them as done.",
    };
  }

  if (/\b(which|what|show|list)\b.*\bleads?\b.*\bfollow[- ]?ups?\b|\bfollow[- ]?ups?\b.*\b(due|today|overdue)\b/.test(text) && !/\b(prepare|draft|write|compose)\b/.test(text)) {
    return { intent: "follow_ups_due", calls: [{ tool: "find_follow_ups_due", args: { limit: 15, ...(/\bmy\b/.test(text) && { mine: true }) } }], confidence: "high" };
  }
  if (/\b(assigned to me|my (open |unresolved )?(cases|tickets))\b/.test(text)) {
    return { intent: "my_tickets", calls: [{ tool: "find_my_open_tickets", args: { limit: 15 } }], confidence: "high" };
  }
  if (/\b(haven'?t|have not|didn'?t|not yet|never)\b.*\b(book|continu|proceed|request)|\bstalled\b|\bdropped? off\b|\bplanned (a )?trips?\b.*\bbut\b/.test(text)) {
    return { intent: "stalled_leads", calls: [{ tool: "find_stalled_leads", args: { limit: 10 } }], confidence: "high" };
  }
  if (/\b(prepare|draft|write|compose)\b.*\bfollow[- ]?up\b|\bfollow[- ]?up (message|note|email)\b/.test(text)) {
    if (!leadTarget) return { intent: "follow_up", calls: [], confidence: "high", note: "Attach a lead (or name the customer) and I'll prepare a follow-up for them." };
    const channel = /\bemail\b/.test(text) ? "email" : /\bcall\b/.test(text) ? "call" : "whatsapp";
    const calls: PlannedCall[] = [{ tool: "draft_follow_up_message", args: { ...leadTarget, channel } }];
    if (ctx.leadId) calls.push({ tool: "schedule_follow_up", args: { leadId: ctx.leadId, channel, message: DRAFT_PLACEHOLDER } });
    return { intent: "follow_up", calls, confidence: "high" };
  }
  if (/\b(urgent|escalat\w*|support cases?|tickets?)\b.*\b(attention|need|urgent|waiting)|\bneed(s)? (urgent )?attention\b.*\b(support|tickets?|cases?)/.test(text) && !/\bassign\b/.test(text)) {
    return { intent: "urgent_support", calls: [{ tool: "find_urgent_support_cases", args: { limit: 10 } }], confidence: "high" };
  }
  if (/\b(budget)\b.*\b(exceed|over|above|beyond)|\bover[- ]budget\b|\bexceeds?\b.*\bbudget\b/.test(text)) {
    return { intent: "over_budget", calls: [{ tool: "find_over_budget_trips", args: { limit: 10 } }], confidence: "high" };
  }
  if (/\b(exceptions?|what went wrong|failures?|failed|problems today|issues today)\b/.test(text)) {
    return { intent: "exceptions", calls: [{ tool: "get_operational_exceptions", args: {} }], confidence: "high" };
  }
  if (/\bassign\b/.test(text) && ticketTarget && "ticketId" in ticketTarget) {
    return { intent: "assign_ticket", calls: [{ tool: "assign_ticket", args: { ticketId: ticketTarget.ticketId, assigneeId: "me" } }], confidence: "high" };
  }
  if (/\bescalate\b/.test(text) && ticketTarget && "ticketId" in ticketTarget) {
    return { intent: "escalate_ticket", calls: [{ tool: "escalate_ticket", args: { ticketId: ticketTarget.ticketId, reason: message.slice(0, 200) } }], confidence: "high" };
  }
  const stage = LEAD_STAGES.find((s) => new RegExp(`\\b(move|mark|set|change)\\b.*\\b(to|as)\\s+${s.replace("_", "[ _]")}\\b`).test(text));
  if (stage && ctx.leadId) {
    const lostReason = stage === "lost" ? (/\bbecause\s+(.{3,120})/.exec(message)?.[1] ?? "No response") : undefined;
    return { intent: "lead_stage", calls: [{ tool: "update_lead_stage", args: { leadId: ctx.leadId, stage, ...(lostReason && { lostReason }) } }], confidence: "high" };
  }
  if (/\bsummari[sz]e|\boverview of\b|\btell me about\b|\brequirements\b|\bconversation\b/.test(text)) {
    if (ticketTarget) return { intent: "ticket_summary", calls: [{ tool: "get_ticket_summary", args: ticketTarget }], confidence: "high" };
    if (ctx.customerKey) return { intent: "customer_summary", calls: [{ tool: "get_customer_context", args: { customerKey: ctx.customerKey } }], confidence: "high" };
    if (leadTarget) {
      const calls: PlannedCall[] = [{ tool: "get_lead_summary", args: leadTarget }];
      if (/\bcustomer|conversation|requirements\b/.test(text)) calls.push({ tool: "get_customer_context", args: leadTarget });
      return { intent: "lead_summary", calls, confidence: "high" };
    }
    if (/\b(today|operations?|operational)\b/.test(text)) return { intent: "exceptions", calls: [{ tool: "get_operational_exceptions", args: {} }], confidence: "high" };
  }
  if (/\b(metrics?|kpis?|conversion|how (are|is) (we|(the )?business|(our )?sales) doing|performance|revenue)\b/.test(text)) {
    return { intent: "metrics", calls: [{ tool: "get_business_metrics", args: { days: 30 } }], confidence: "high" };
  }
  if (/\b(pending|queues?|what needs (my )?attention|to[- ]?do|backlog|what should i (do|work on))\b/.test(text)) {
    return { intent: "pending", calls: [{ tool: "get_pending_operations", args: {} }], confidence: "high" };
  }
  if (ctx.leadId && /\b(next|should|do)\b/.test(text)) return { intent: "lead_summary", calls: [{ tool: "get_lead_summary", args: { leadId: ctx.leadId } }], confidence: "high" };
  if (ctx.ticketId) return { intent: "ticket_summary", calls: [{ tool: "get_ticket_summary", args: { ticketId: ctx.ticketId } }], confidence: "low" };
  const policy = /\b(policy|policies|sop|procedure|playbook|terms|sla|cancell?ation|refund rules?|how do (we|i))\b/.test(text);
  return { intent: "knowledge", calls: [{ tool: "search_company_knowledge", args: { query: message.slice(0, 200) } }], confidence: policy ? "high" : "low" };
}
