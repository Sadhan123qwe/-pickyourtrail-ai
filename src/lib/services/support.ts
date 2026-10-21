import "server-only";
import { z } from "zod";
import { runStructured } from "@/lib/ai/run";
import { recordUsage } from "@/lib/ai/usage";
import { canAccessTicket, canAccessTrip, ownsRecord } from "@/lib/auth/permissions";
import { badRequest, forbidden, notFound, type Actor } from "@/lib/http";
import { cacheGet, cacheKey, cacheSet } from "@/lib/repos/cache";
import { addMessage, createConversation, getConversation, latestConversationForOwner, listMessages } from "@/lib/repos/conversations";
import { OPS_STATUS_LABELS, latestHandoffForTrip } from "@/lib/repos/handoffs";
import { searchKnowledge, type KnowledgeHit } from "@/lib/repos/knowledge";
import { addTicketMessage, createTicket, getTicket, listTicketMessages } from "@/lib/repos/tickets";
import { getTripRow, listTripsForOwner } from "@/lib/repos/trips";
import { triageMessage, type Triage } from "@/lib/workflows/rules";

const SUPPORT_SYSTEM = `You are a customer support assistant for a travel company.
Input JSON: question, sources (approved help articles; the ONLY facts you may use).
Rules:
- Answer only from the sources. If they don't answer the question, say you're not sure and set needsHuman=true.
- Never invent cancellation charges, refund eligibility or amounts, flight availability, prices or booking status.
- Refunds, cancellations and anything urgent must be confirmed by a human agent: set needsHuman=true.
- Be concise (max 90 words), friendly and plain. Do not use markdown headings.
- usedSourceIds must list the ids of the sources you relied on.`;

const SupportAnswerSchema = z.strictObject({
  answer: z.string(),
  usedSourceIds: z.array(z.string()),
  needsHuman: z.boolean(),
});
type SupportAnswer = z.infer<typeof SupportAnswerSchema>;

export interface SupportReply {
  conversationId: string;
  reply: string;
  sources: { id: string; title: string; isDemo: boolean }[];
  triage: Triage;
  offerTicket: boolean;
  ticket: { id: string; ref: string } | null;
  ai: { source: string; notice: string | null };
}

const PERSONAL_RE = /\b(my|our)\s+(booking|trip|order|ticket|refund|payment|reservation|itinerary|flight|hotel)\b|\bstatus\b/;

function loadSupportConversation(actor: Actor, conversationId: string | null | undefined) {
  if (conversationId) {
    const conv = getConversation(conversationId);
    if (!conv || conv.kind !== "support") throw notFound("Conversation not found");
    if (!ownsRecord(actor, conv)) throw forbidden();
    return conv;
  }
  return latestConversationForOwner(actor, "support") ?? createConversation(actor, "support");
}

/** Facts about the customer's own trips, from the database (never generated). */
function tripStatusFacts(actor: Actor): string | null {
  const trips = listTripsForOwner(actor).slice(0, 3);
  if (!trips.length) return null;
  const lines = trips.map((t) => {
    const h = latestHandoffForTrip(t.id);
    const booking = h
      ? `booking request ${OPS_STATUS_LABELS[h.ops_status].toLowerCase()}; provider confirmation: ${h.provider_status === "provider_confirmed" ? `confirmed (ref ${h.provider_reference})` : "not confirmed"}`
      : "no booking request yet";
    return `• ${t.title}: ${t.status.replace(/_/g, " ")}, ${booking}.`;
  });
  return `Here's what I can see on your account:\n${lines.join("\n")}\nNothing is booked until a travel expert confirms with suppliers.`;
}

function composeFromSources(hits: KnowledgeHit[]): string {
  const top = hits[0];
  const text = top.snippet.replace(/^Demonstration content:[^\n]*\n?/i, "").trim();
  return `Here's what our help article “${top.title}” says:\n\n${text}`;
}

export async function supportChat(args: { actor: Actor; message: string; conversationId?: string | null; tripId?: string | null; clientMessageId?: string | null }): Promise<SupportReply> {
  const { actor } = args;
  const conversation = loadSupportConversation(actor, args.conversationId);
  const { duplicate } = addMessage(conversation.id, "user", args.message, null, args.clientMessageId ?? null);
  if (duplicate) {
    const last = [...listMessages(conversation.id)].reverse().find((m) => m.role === "assistant");
    return {
      conversationId: conversation.id,
      reply: last?.content ?? "",
      sources: [],
      triage: triageMessage(args.message),
      offerTicket: false,
      ticket: null,
      ai: { source: "duplicate", notice: null },
    };
  }

  let tripStart: number | null = null;
  if (args.tripId) {
    const trip = getTripRow(args.tripId);
    if (trip && canAccessTrip(actor, trip) && trip.start_date) tripStart = Math.round((Date.parse(trip.start_date) - Date.now()) / 86_400_000);
  }
  const triage = triageMessage(args.message, tripStart);
  const hits = searchKnowledge(args.message, { includeInternal: false, limit: 3 });
  const sources = hits.map((h) => ({ id: h.id, title: h.title, isDemo: h.isDemo }));
  let reply: string;
  let offerTicket = false;
  let ticket: SupportReply["ticket"] = null;
  let ai: SupportReply["ai"] = { source: "rules", notice: null };

  if (triage.urgent) {
    // Urgent problems skip the AI entirely and go to a human.
    const created = createTicket({
      owner: actor,
      subject: args.message.slice(0, 80),
      body: args.message,
      category: triage.category,
      priority: "urgent",
      escalate: true,
      escalationReason: triage.reason,
      tripId: args.tripId ?? null,
      conversationId: conversation.id,
      contactEmail: actor.user?.email ?? null,
      idempotencyKey: args.clientMessageId ? `chat:${args.clientMessageId}` : null,
    });
    ticket = { id: created.ticket.id, ref: created.ticket.ref };
    reply = `I'm sorry you're dealing with this. I've marked it **urgent** and passed it to a human agent right away (ticket ${created.ticket.ref}). ${
      hits[0] && hits[0].slug === "on-trip-emergency" ? `While you wait: ${hits[0].snippet.replace(/^Demonstration content:[^\n]*\n?/i, "").split("\n")[0]}` : "If anyone is in danger, contact local emergency services first."
    }`;
  } else if (PERSONAL_RE.test(args.message.toLowerCase()) && /\b(status|booked|confirmed|where)\b/.test(args.message.toLowerCase())) {
    reply = tripStatusFacts(actor) ?? "I couldn't find any trips on this browser or account. If you booked with another email, sign in with it or create a ticket and an agent will check.";
    offerTicket = true;
  } else if (!hits.length) {
    reply = "I couldn't find an answer to that in our help articles, and I don't want to guess. Would you like me to create a ticket so a travel expert can help?";
    offerTicket = true;
  } else {
    const personal = PERSONAL_RE.test(args.message.toLowerCase());
    const key = cacheKey("support-faq", [args.message.toLowerCase().replace(/\s+/g, " ").trim(), hits.map((h) => `${h.id}@${h.version}`)]);
    const cached = personal ? undefined : cacheGet<SupportAnswer>(key);
    let answer: SupportAnswer;
    if (cached) {
      answer = cached;
      ai = { source: "cache", notice: null };
      recordUsage({ actorKey: actor.key, category: "support", provider: "cache", outcome: "cache_hit" });
    } else {
      const outcome = await runStructured({
        actorKey: actor.key,
        category: "support",
        tier: "routine",
        system: SUPPORT_SYSTEM,
        input: JSON.stringify({ question: args.message.slice(0, 1000), sources: hits.map((h) => ({ id: h.id, title: h.title, text: h.snippet })) }),
        schema: SupportAnswerSchema,
        schemaName: "support_answer",
        maxOutputTokens: 350,
        fallback: () => ({ answer: composeFromSources(hits), usedSourceIds: [hits[0].id], needsHuman: triage.escalate }),
      });
      answer = outcome.value;
      ai = { source: outcome.source, notice: outcome.notice };
      if (!personal && outcome.source === "live") cacheSet(key, answer, 24 * 3600);
    }
    const used = sources.filter((s) => answer.usedSourceIds.includes(s.id));
    sources.splice(0, sources.length, ...(used.length ? used : sources.slice(0, 1)));
    reply = answer.answer;
    offerTicket = answer.needsHuman || triage.escalate;
    if (triage.escalate) reply += "\n\nRefunds and cancellations must be confirmed by a human agent — I can create a ticket for you.";
  }

  addMessage(conversation.id, "assistant", reply, { sources, offerTicket, ticket, triage: { category: triage.category, priority: triage.priority }, aiSource: ai.source });
  return { conversationId: conversation.id, reply, sources, triage, offerTicket, ticket, ai };
}

export function supportConversation(actor: Actor) {
  const conv = latestConversationForOwner(actor, "support");
  return conv ? { conversationId: conv.id, messages: listMessages(conv.id) } : { conversationId: null, messages: [] };
}

export function createSupportTicket(args: {
  actor: Actor;
  subject?: string | null;
  message: string;
  tripId?: string | null;
  conversationId?: string | null;
  contactEmail?: string | null;
  idempotencyKey?: string | null;
}) {
  const { actor } = args;
  let tripId: string | null = null;
  let tripStart: number | null = null;
  if (args.tripId) {
    const trip = getTripRow(args.tripId);
    if (!trip || !ownsRecord(actor, trip)) throw badRequest("That trip isn't linked to your account");
    tripId = trip.id;
    if (trip.start_date) tripStart = Math.round((Date.parse(trip.start_date) - Date.now()) / 86_400_000);
  }
  let transcript: { author: "customer" | "ai"; body: string }[] = [];
  let conversationId: string | null = null;
  if (args.conversationId) {
    const conv = getConversation(args.conversationId);
    if (conv && conv.kind === "support" && ownsRecord(actor, conv)) {
      conversationId = conv.id;
      transcript = listMessages(conv.id)
        .slice(-8)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ author: m.role === "user" ? ("customer" as const) : ("ai" as const), body: m.content }));
    }
  }
  const triage = triageMessage(`${args.subject ?? ""} ${args.message}`, tripStart);
  const result = createTicket({
    owner: actor,
    subject: args.subject?.trim() || args.message.slice(0, 80),
    body: args.message,
    category: triage.category,
    priority: triage.priority,
    escalate: triage.escalate,
    escalationReason: triage.reason,
    tripId,
    conversationId,
    contactEmail: args.contactEmail ?? actor.user?.email ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
    transcript,
  });
  return { ...result, triage };
}

export function loadTicketForActor(actor: Actor, ticketId: string) {
  const ticket = getTicket(ticketId);
  if (!ticket) throw notFound("Ticket not found");
  if (!canAccessTicket(actor, ticket)) throw forbidden("You don't have access to this ticket");
  return ticket;
}

export function ticketDetail(actor: Actor, ticketId: string, includeInternal: boolean) {
  const ticket = loadTicketForActor(actor, ticketId);
  return { ticket, messages: listTicketMessages(ticket.id, includeInternal) };
}

export function postTicketMessage(actor: Actor, ticketId: string, body: string, opts: { asAgent: boolean; internal?: boolean }) {
  const ticket = loadTicketForActor(actor, ticketId);
  if (ticket.status === "closed") throw badRequest("This ticket is closed. Please open a new ticket.");
  if (!opts.asAgent && !ownsRecord(actor, ticket)) throw forbidden();
  return addTicketMessage({
    ticket,
    authorType: opts.asAgent ? "agent" : "customer",
    authorUserId: actor.userId,
    body,
    internal: opts.asAgent && !!opts.internal,
  });
}
