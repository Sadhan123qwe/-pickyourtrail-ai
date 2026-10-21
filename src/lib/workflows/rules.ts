import { ESSENTIAL_FIELDS, isAnswered, totalTravellers, type TripProfile, DEMO_FX_TO_INR } from "@/lib/planner/profile";

/* ------------------------------------------------------------------ */
/* Lead stages                                                         */
/* ------------------------------------------------------------------ */

export const LEAD_STAGES = ["new", "contacted", "qualified", "proposal_sent", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

const LEAD_TRANSITIONS: Record<LeadStage, LeadStage[]> = {
  new: ["contacted", "qualified", "lost"],
  contacted: ["qualified", "proposal_sent", "lost"],
  qualified: ["contacted", "proposal_sent", "lost"],
  proposal_sent: ["qualified", "won", "lost"],
  won: [],
  lost: ["contacted"], // reopen
};

export function canTransitionLead(from: LeadStage, to: LeadStage): boolean {
  return LEAD_TRANSITIONS[from].includes(to);
}

export function allowedLeadTransitions(from: LeadStage): LeadStage[] {
  return LEAD_TRANSITIONS[from];
}

export function isOpenLeadStage(stage: LeadStage): boolean {
  return stage !== "won" && stage !== "lost";
}

/** Whether a planning session has enough meaningful detail to become a sales lead. */
export function qualifiesAsLead(p: TripProfile): boolean {
  if (!p.destinationId && !p.destinationOpen) return false;
  const signals = [p.durationDays !== null, p.adults !== null, p.budgetAmount !== null, !!p.travelMonth || !!p.startDate];
  return signals.filter(Boolean).length >= 2;
}

/** Deterministic lead score 0–100. */
export function scoreLead(p: TripProfile, opts: { hasContact: boolean; hasItinerary: boolean; handoffRequested: boolean; today?: Date }): number {
  let score = 0;
  score += ESSENTIAL_FIELDS.filter((f) => isAnswered(f, p)).length * 8; // up to 40
  const budgetInr = p.budgetAmount !== null ? p.budgetAmount * DEMO_FX_TO_INR[p.currency] * (p.budgetScope === "per_person" ? totalTravellers(p) : 1) : 0;
  if (budgetInr >= 400_000) score += 15;
  else if (budgetInr >= 150_000) score += 10;
  else if (budgetInr > 0) score += 5;
  const start = p.startDate ?? (p.travelMonth ? `${p.travelMonth}-15` : null);
  if (start) {
    const days = (Date.parse(start) - (opts.today ?? new Date()).getTime()) / 86_400_000;
    if (days >= 0 && days <= 120) score += 10;
  }
  if (opts.hasContact) score += 15;
  if (opts.hasItinerary) score += 10;
  if (opts.handoffRequested) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function estimatedLeadValue(p: TripProfile, itineraryTotal: number | null): number | null {
  if (itineraryTotal) return itineraryTotal;
  if (p.budgetAmount === null) return null;
  const inr = p.budgetAmount * DEMO_FX_TO_INR[p.currency];
  return Math.round(p.budgetScope === "per_person" ? inr * totalTravellers(p) : inr);
}

/* ------------------------------------------------------------------ */
/* Support tickets                                                     */
/* ------------------------------------------------------------------ */

export const TICKET_STATUSES = ["open", "in_progress", "pending_customer", "escalated", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  pending_customer: "Waiting on customer",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "pending_customer", "escalated", "resolved", "closed"],
  in_progress: ["pending_customer", "escalated", "resolved"],
  pending_customer: ["in_progress", "escalated", "resolved", "closed"],
  escalated: ["in_progress", "resolved"],
  resolved: ["closed", "in_progress"],
  closed: [],
};

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

export function allowedTicketTransitions(from: TicketStatus): TicketStatus[] {
  return TICKET_TRANSITIONS[from];
}

export const TICKET_CATEGORIES = [
  "booking_change",
  "cancellation_refund",
  "payment",
  "visa_documents",
  "itinerary_question",
  "emergency",
  "general",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  booking_change: "Booking change",
  cancellation_refund: "Cancellation / refund",
  payment: "Payment",
  visa_documents: "Visa & documents",
  itinerary_question: "Itinerary question",
  emergency: "Travel emergency",
  general: "General",
};

export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface Triage {
  category: TicketCategory;
  priority: TicketPriority;
  urgent: boolean;
  escalate: boolean;
  reason: string | null;
}

const URGENT_RE =
  /\b(stranded|stuck at (the )?airport|missed (my |our )?(flight|connection)|flight (was |got |is )?cancell?ed|lost (my |our )?passport|passport (was )?stolen|emergency|hospital|medical|accident|injur(ed|y)|police|robbed|unsafe|no hotel|hotel (has no|won'?t give|refused)|denied boarding|today|tonight|right now|immediately)\b/;
const HIGH_RE = /\b(refund|charged twice|double charged|cancel (my|the|our) (booking|trip)|tomorrow|complaint|wrong (date|name)|urgent|asap)\b/;

/** Deterministic triage: no AI needed to classify or prioritise. */
export function triageMessage(text: string, tripStartsInDays?: number | null): Triage {
  const t = text.toLowerCase();
  const category: TicketCategory = URGENT_RE.test(t) && /\b(stranded|stuck|missed|lost|stolen|emergency|hospital|medical|accident|injur|police|robbed|unsafe|denied boarding|no hotel)\b/.test(t)
    ? "emergency"
    : /\b(refund|cancel\w*)\b/.test(t)
      ? "cancellation_refund"
      : /\b(pay(ment)?|charged|invoice|emi|card|upi|transaction)\b/.test(t)
        ? "payment"
        : /\b(visa|passport|document\w*|insurance|entry requirement\w*)\b/.test(t)
          ? "visa_documents"
          : /\b(change|reschedule|modify|postpone|prepone|update (my|the) (dates?|names?|booking))\b/.test(t)
            ? "booking_change"
            : /\b(itinerary|activity|activities|hotel|transfer|sightseeing|day \d)\b/.test(t)
              ? "itinerary_question"
              : "general";
  let priority: TicketPriority = "normal";
  if (category === "emergency") priority = "urgent";
  else if (URGENT_RE.test(t) && tripStartsInDays !== undefined && tripStartsInDays !== null && tripStartsInDays <= 1) priority = "urgent";
  else if (HIGH_RE.test(t) || (tripStartsInDays !== undefined && tripStartsInDays !== null && tripStartsInDays <= 3)) priority = "high";
  else if (category === "general" && t.length < 80) priority = "low";
  const urgent = priority === "urgent";
  const escalate = urgent || category === "cancellation_refund";
  return {
    category,
    priority,
    urgent,
    escalate,
    reason: urgent ? "Urgent travel problem — routed to a human agent immediately" : escalate ? "Policy-sensitive request (refunds/cancellations) needs a human agent" : null,
  };
}

const PRIORITY_RANK: Record<TicketPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
export function maxPriority(a: TicketPriority, b: TicketPriority): TicketPriority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}
