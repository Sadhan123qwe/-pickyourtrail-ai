/**
 * Rule-based "next best action" for a lead. Deterministic and explainable;
 * the AI Copilot can elaborate, but nothing here sends or changes anything.
 */
export interface NextAction {
  action: string;
  reason: string;
  urgency: "high" | "medium" | "low";
}

export function suggestNextAction(
  lead: { stage: string; email: string | null; trip_status: string | null; score: number; next_follow_up_at: string | null },
  followUps: { status: string; due_at: string }[],
  now = Date.now(),
): NextAction {
  const pending = followUps.filter((f) => f.status === "pending").sort((a, b) => a.due_at.localeCompare(b.due_at));
  const overdue = pending.find((f) => Date.parse(f.due_at) < now);
  if (lead.stage === "won") return { action: "Hand over to operations and confirm supplier bookings", reason: "The lead is won.", urgency: "low" };
  if (lead.stage === "lost") return { action: "No action — reopen only if the customer comes back", reason: "The lead is closed as lost.", urgency: "low" };
  if (overdue) return { action: "Complete the overdue follow-up today", reason: `A follow-up was due ${new Date(overdue.due_at).toLocaleDateString("en-IN")} and is still pending.`, urgency: "high" };
  if (lead.trip_status === "handoff_requested") return { action: "Coordinate with ops and send the final quote", reason: "The customer requested a booking.", urgency: "high" };
  if (lead.stage === "new") return { action: "Make first contact within 24 hours", reason: "New lead from the AI planner (sales playbook).", urgency: lead.score >= 70 ? "high" : "medium" };
  if (!lead.email) return { action: "Ask for an email address", reason: "A proposal can't be shared without contact details.", urgency: "medium" };
  if (lead.stage === "contacted") return { action: "Qualify: confirm dates, budget and decision-maker", reason: "Contacted but not yet qualified.", urgency: "medium" };
  if (lead.stage === "qualified") return { action: "Send a proposal within 48 hours", reason: "Qualified leads should receive a proposal quickly.", urgency: "medium" };
  if (lead.stage === "proposal_sent" && !pending.length) return { action: "Schedule a proposal follow-up", reason: "No follow-up is scheduled after the proposal.", urgency: "medium" };
  return { action: "Keep the scheduled follow-up", reason: "A follow-up is already planned.", urgency: "low" };
}
