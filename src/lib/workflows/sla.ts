/**
 * Support SLA rules (first human response targets by priority). These are the
 * configured rules used for SLA indicators; they mirror the demo support SOP.
 */
export const FIRST_RESPONSE_SLA_MINUTES: Record<string, number> = {
  urgent: 15,
  high: 120,
  normal: 24 * 60,
  low: 48 * 60,
};

export type SlaState = { state: "met" | "breached" | "due" | "at_risk"; minutes: number; label: string };

function fmt(minutes: number) {
  const m = Math.abs(Math.round(minutes));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  return `${Math.round(m / 1440)}d`;
}

/** First-response SLA status for a ticket, computed in code. */
export function firstResponseSla(t: { priority: string; created_at: string; first_response_at: string | null; status: string }, now = Date.now()): SlaState | null {
  const target = FIRST_RESPONSE_SLA_MINUTES[t.priority];
  if (!target) return null;
  const created = Date.parse(t.created_at);
  if (t.first_response_at) {
    const took = (Date.parse(t.first_response_at) - created) / 60000;
    return took <= target ? { state: "met", minutes: took, label: `Responded in ${fmt(took)}` } : { state: "breached", minutes: took - target, label: `Responded ${fmt(took - target)} late` };
  }
  if (["resolved", "closed"].includes(t.status)) return null;
  const remaining = target - (now - created) / 60000;
  if (remaining < 0) return { state: "breached", minutes: -remaining, label: `First response overdue by ${fmt(-remaining)}` };
  return { state: remaining < target * 0.25 ? "at_risk" : "due", minutes: remaining, label: `First response due in ${fmt(remaining)}` };
}
