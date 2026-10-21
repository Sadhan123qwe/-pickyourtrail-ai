import "server-only";
import { z } from "zod";
import { runStructured } from "@/lib/ai/run";
import { can } from "@/lib/auth/permissions";
import { forbidden, notFound, type Actor } from "@/lib/http";
import { formatMoney } from "@/lib/planner/profile";
import { getLead, leadPreferencesSummary, listFollowUps, listLeadActivities } from "@/lib/repos/leads";
import { searchKnowledge } from "@/lib/repos/knowledge";
import { getTicket, listTicketMessages } from "@/lib/repos/tickets";
import { LEAD_STAGE_LABELS, TICKET_CATEGORY_LABELS, allowedLeadTransitions } from "@/lib/workflows/rules";

/**
 * Employee copilot. Facts come from the database and approved documents,
 * filtered by the employee's permissions, and are returned separately from
 * anything the AI writes so staff can always tell evidence from suggestion.
 */

export interface CopilotFact {
  label: string;
  value: string;
  source: string;
}

export interface CopilotResponse {
  facts: CopilotFact[];
  documents: { id: string; title: string; snippet: string; audience: string; isDemo: boolean }[];
  answer: string;
  suggestions: string[];
  draft: string | null;
  ai: { source: string; notice: string | null };
  notFoundInKnowledge: boolean;
}

const COPILOT_SYSTEM = `You are an internal assistant for travel-company employees (sales, support, operations).
Input JSON: request (the employee's question), intent, facts (database records), documents (approved company documents).
Rules:
- Use only the facts and documents as evidence. If they don't contain the answer, say so plainly; never invent company policies, prices, refund rules or booking confirmations.
- answer: a concise response (max 120 words).
- suggestions: 1–4 concrete next actions for the employee.
- draft: when the intent is a customer message, write a short, warm message (max 120 words) the employee can edit; otherwise null. Never promise prices or availability in drafts.`;

const CopilotSchema = z.strictObject({
  answer: z.string(),
  suggestions: z.array(z.string()),
  draft: z.string().nullable(),
});

type Intent = "draft_follow_up" | "draft_reply" | "next_action" | "summarize" | "question";

function detectIntent(q: string): Intent {
  const t = q.toLowerCase();
  if (/\b(draft|write|compose)\b.*\b(reply|response|answer)\b|\breply to\b/.test(t)) return "draft_reply";
  if (/\b(draft|write|compose)\b.*\b(follow[- ]?up|message|email|whatsapp)\b|\bfollow[- ]?up message\b/.test(t)) return "draft_follow_up";
  if (/\b(next (step|action|best action)|what should i do|suggest)\b/.test(t)) return "next_action";
  if (/\b(summar|overview|brief|tl;?dr)\w*/.test(t)) return "summarize";
  return "question";
}

export async function copilotChat(actor: Actor, input: { message: string; leadId?: string | null; ticketId?: string | null }): Promise<CopilotResponse> {
  const role = actor.role;
  const intent = detectIntent(input.message);
  const facts: CopilotFact[] = [];
  let lead: ReturnType<typeof getLead> | undefined;
  let ticket: ReturnType<typeof getTicket> | undefined;

  if (input.leadId) {
    if (!can(role, "leads:read")) throw forbidden("Your role can't view sales leads");
    lead = getLead(input.leadId);
    if (!lead) throw notFound("Lead not found");
    facts.push(
      { label: "Customer", value: `${lead.name}${lead.email ? ` <${lead.email}>` : ""}`, source: `Lead ${lead.id}` },
      { label: "Stage", value: LEAD_STAGE_LABELS[lead.stage], source: "CRM" },
      { label: "Destination", value: lead.destination ?? "Not chosen", source: "CRM" },
      { label: "Score", value: `${lead.score}/100`, source: "CRM (deterministic score)" },
    );
    if (lead.estimated_value) facts.push({ label: "Estimated value", value: formatMoney(lead.estimated_value), source: "Itinerary estimate" });
    const prefs = leadPreferencesSummary(lead);
    if (prefs) facts.push({ label: "Trip preferences", value: prefs, source: "Trip profile" });
    const pending = listFollowUps(lead.id).filter((f) => f.status === "pending");
    if (pending.length) facts.push({ label: "Pending follow-ups", value: pending.map((f) => `${f.channel} due ${f.due_at.slice(0, 10)}`).join(", "), source: "CRM" });
    const activity = listLeadActivities(lead.id).slice(0, 3);
    if (activity.length) facts.push({ label: "Recent activity", value: activity.map((a) => a.body).join(" | ").slice(0, 400), source: "Lead activity log" });
  }
  if (input.ticketId) {
    if (!can(role, "tickets:read")) throw forbidden("Your role can't view support tickets");
    ticket = getTicket(input.ticketId);
    if (!ticket) throw notFound("Ticket not found");
    facts.push(
      { label: "Ticket", value: `${ticket.ref} — ${ticket.subject}`, source: "Support" },
      { label: "Status / priority", value: `${ticket.status.replace(/_/g, " ")} · ${ticket.priority}`, source: "Support" },
      { label: "Category", value: TICKET_CATEGORY_LABELS[ticket.category], source: "Support (deterministic triage)" },
    );
    const msgs = listTicketMessages(ticket.id, can(role, "tickets:write")).slice(-4);
    if (msgs.length) facts.push({ label: "Latest messages", value: msgs.map((m) => `${m.author_type}: ${m.body}`).join(" | ").slice(0, 600), source: "Ticket history" });
  }

  const docs = searchKnowledge(`${input.message} ${ticket?.subject ?? ""} ${ticket ? TICKET_CATEGORY_LABELS[ticket.category] : ""}`, {
    includeInternal: can(role, "knowledge:read_internal"),
    limit: 3,
  });
  const documents = docs.map((d) => ({ id: d.id, title: d.title, snippet: d.snippet, audience: d.audience, isDemo: d.isDemo }));
  const notFoundInKnowledge = docs.length === 0 && facts.length === 0;

  const outcome = await runStructured({
    actorKey: actor.key,
    category: "copilot",
    tier: "routine",
    system: COPILOT_SYSTEM,
    input: JSON.stringify({ request: input.message.slice(0, 1000), intent, facts, documents: documents.map((d) => ({ title: d.title, text: d.snippet })) }),
    schema: CopilotSchema,
    schemaName: "copilot_answer",
    maxOutputTokens: 600,
    fallback: () => deterministicCopilot(intent, lead, ticket, documents, actor.user?.name ?? "the team"),
  });

  return {
    facts,
    documents,
    answer: outcome.value.answer,
    suggestions: outcome.value.suggestions.slice(0, 4),
    draft: outcome.value.draft,
    ai: { source: outcome.source, notice: outcome.notice },
    notFoundInKnowledge,
  };
}

function firstName(name: string) {
  return name.split(" ")[0];
}

/** Template-based copilot used in demo mode and as the AI fallback. */
function deterministicCopilot(
  intent: Intent,
  lead: ReturnType<typeof getLead> | undefined,
  ticket: ReturnType<typeof getTicket> | undefined,
  documents: { title: string; snippet: string }[],
  employee: string,
): z.infer<typeof CopilotSchema> {
  const suggestions: string[] = [];
  let answer = "";
  let draft: string | null = null;
  const doc = documents[0];
  const docText = doc ? doc.snippet.replace(/^Demonstration content:[^\n]*\n?/i, "").trim() : null;

  if (lead) {
    const next = allowedLeadTransitions(lead.stage);
    if (lead.stage === "new") suggestions.push("Call within 24 hours and confirm dates, party size and budget (sales playbook).");
    if (lead.stage === "contacted") suggestions.push("Qualify: confirm budget range and decision-maker, then move to Qualified.");
    if (lead.stage === "qualified") suggestions.push("Send a proposal within 48 hours highlighting activities that match their interests.");
    if (lead.stage === "proposal_sent") suggestions.push("Follow up on day 1, 3 and 7 after the proposal.");
    if (!lead.email) suggestions.push("Ask for an email address so the proposal can be shared.");
    if (lead.trip_status === "handoff_requested") suggestions.push("The customer asked to book — coordinate with ops on the handoff.");
    if (next.length) suggestions.push(`Possible stage moves: ${next.map((s) => LEAD_STAGE_LABELS[s]).join(", ")}.`);
    answer = `${lead.name} is a ${LEAD_STAGE_LABELS[lead.stage].toLowerCase()} lead for ${lead.destination ?? "an undecided destination"}${lead.travellers ? ` (${lead.travellers} travellers)` : ""}, scored ${lead.score}/100.`;
    if (intent === "draft_follow_up" || intent === "draft_reply") {
      draft = `Hi ${firstName(lead.name)}, thanks for planning your ${lead.destination ?? "trip"} with us! I've reviewed the itinerary you created and would love to help fine-tune it — dates, hotels or activities. Would you have 10 minutes for a quick call this week? I'll confirm exact prices and availability once we lock the details.\n\nBest,\n${employee}`;
    }
  }
  if (ticket) {
    suggestions.push(
      ticket.priority === "urgent" ? "Respond within 15 minutes and keep the customer updated (support SOP)." : "Reply with a clear next step and expected timeline.",
    );
    if (ticket.category === "cancellation_refund") suggestions.push("Check supplier terms before confirming any refund amount.");
    if (!ticket.assigned_to) suggestions.push("Assign the ticket to yourself or a teammate.");
    answer = `${answer ? `${answer} ` : ""}Ticket ${ticket.ref} is ${ticket.status.replace(/_/g, " ")} with ${ticket.priority} priority (${TICKET_CATEGORY_LABELS[ticket.category].toLowerCase()}).`;
    if (intent === "draft_reply" || intent === "draft_follow_up") {
      draft = `Hi ${ticket.customer_name ? firstName(ticket.customer_name) : "there"}, thank you for contacting us about “${ticket.subject}”. I'm looking into this now${
        ticket.category === "cancellation_refund" ? " and will confirm the exact refund position once I've checked with our suppliers" : ""
      }. I'll update you shortly.\n\nBest regards,\n${employee}`;
    }
  }
  if (!lead && !ticket) {
    answer = docText ? `From “${doc!.title}”: ${docText.slice(0, 500)}` : "I couldn't find this in the approved knowledge base, so I won't guess. Check with your team lead or add the policy to the knowledge base.";
    if (intent === "draft_follow_up" || intent === "draft_reply") {
      draft = `Hi, thanks for getting in touch! ${docText ? docText.split(". ").slice(0, 2).join(". ") + "." : "I'll check the details and get back to you shortly."}\n\nBest,\n${employee}`;
    }
  } else if (docText && intent === "question") {
    answer += ` Relevant guidance from “${doc!.title}”: ${docText.slice(0, 300)}`;
  }
  if (!suggestions.length) suggestions.push(docText ? `Review “${doc!.title}” before replying.` : "Escalate to your team lead if this isn't covered by policy.");
  return { answer, suggestions: suggestions.slice(0, 4), draft };
}
