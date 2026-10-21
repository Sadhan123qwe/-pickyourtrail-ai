import "server-only";
import { runStructured, type AiSource } from "@/lib/ai/run";
import { canAccessTrip } from "@/lib/auth/permissions";
import { forbidden, notFound, type Actor } from "@/lib/http";
import { LlmExtractionSchema, fromLlmExtraction, type ExtractionResult } from "@/lib/planner/extraction";
import { fieldForQuestion, initialTurn, processTurn, summarizeProfile, type PlannerQuestion, type TurnResult } from "@/lib/planner/engine";
import { completion, type FieldStatus, type Provenance, type TripProfile } from "@/lib/planner/profile";
import { tx } from "@/lib/db";
import { extractWithRules } from "@/lib/planner/rules-extractor";
import { qualifiesAsLead } from "@/lib/workflows/rules";
import { executeTool } from "@/lib/ai/tools/registry";
import { ACTIVITY_FIELDS, COST_FIELDS, detectRevision, matchItem, type RevisionIntent } from "@/lib/planner/revisions";
import { addMessage, createConversation, findConversationForTrip, listMessages, replyAfter, updateConversationSummary, type MessageRecord } from "@/lib/repos/conversations";
import { addLeadActivity, upsertLeadFromTrip } from "@/lib/repos/leads";
import { latestItineraryForTrip, latestItinerarySummary } from "@/lib/repos/itineraries";
import { latestHandoffForTrip } from "@/lib/repos/handoffs";
import { VersionConflictError, createTrip, getPreferences, getTripRow, savePlannerState, type TripRow } from "@/lib/repos/trips";

/** Stable instructions (identical on every call, so they are prompt-cache friendly). */
const PLANNER_SYSTEM = `You extract travel preferences for a travel company's trip planner.
Input is JSON with: today (YYYY-MM-DD), lastQuestion (the topic the assistant just asked about, may be null), profile (what is already known), message (the customer's latest message).
Rules:
- Return values ONLY for details the customer stated or clearly implied in THIS message. Use null for everything else. Never repeat values from profile unless the customer changed them.
- A short reply usually answers lastQuestion (e.g. "4" after lastQuestion=travellers means 4 adults; "no" after budgetIncludesFlights means false).
- Resolve months and dates to the next future occurrence after today. "5 nights" means durationDays=6.
- Amounts: 1 lakh = 100000, 1 crore = 10000000, "150k" = 150000. Default currency INR unless another is stated.
- "family of 4" without details: adults=2, children=2.
- If the customer says they don't know or aren't sure about a topic, list it in unknownFields. If unsure where to go, set wantsRecommendations=true.
- "none"/"nothing specific" for requirements or must-sees goes in noneFields. "skip" goes in skippedFields.
- interests must use only the allowed enum values.
- If the customer asks a question, copy it to sideQuestion and give a one or two sentence general answer in sideAnswer. Never state prices, availability, visa guarantees, refund rules or booking status.`;

export interface PlannerTurnResponse {
  trip: TripRow;
  conversationId: string;
  profile: TripProfile;
  status: Record<string, string>;
  provenance?: Provenance;
  version: number;
  completion: { resolved: number; total: number };
  turn: Pick<TurnResult, "reply" | "question" | "stage" | "captured" | "recommendations"> & { itineraryUpdate?: ItineraryUpdate | null };
  ai: { source: AiSource | "rules"; notice: string | null };
  duplicate?: boolean;
}

function compactProfile(p: TripProfile): Record<string, unknown> {
  // Only send non-empty fields: fewer tokens per request.
  return Object.fromEntries(
    Object.entries(p).filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && v.length === 0)),
  );
}

const SUMMARY_INTENT = /^\s*(please\s+)?(can you\s+|could you\s+)?(summari[sz]e|recap)\b|\bwhat (do you have|have we got|have you got) so far\b|\b(summary|recap) of (my|the|our) trip\b/i;

export function loadTripForActor(actor: Actor, tripId: string): TripRow {
  const trip = getTripRow(tripId);
  if (!trip) throw notFound("Trip not found");
  if (!canAccessTrip(actor, trip)) throw forbidden("You don't have access to this trip");
  return trip;
}

/** Starts a new planning session (trip + conversation + greeting). */
export function startPlanning(actor: Actor): PlannerTurnResponse {
  const trip = createTrip(actor);
  const conversation = createConversation(actor, "planner", trip.id);
  const first = initialTurn();
  addMessage(conversation.id, "assistant", first.reply, { question: first.question, stage: first.stage });
  const prefs = getPreferences(trip.id)!;
  return {
    trip,
    conversationId: conversation.id,
    profile: prefs.profile,
    status: prefs.status,
    version: prefs.version,
    completion: completion(prefs.profile, prefs.status),
    turn: { reply: first.reply, question: first.question, stage: first.stage, captured: [], recommendations: [] },
    ai: { source: "rules", notice: null },
  };
}

export function plannerSnapshot(actor: Actor, tripId: string) {
  const trip = loadTripForActor(actor, tripId);
  const conversation = findConversationForTrip(trip.id, "planner") ?? createConversation(actor, "planner", trip.id);
  const prefs = getPreferences(trip.id)!;
  const messages = listMessages(conversation.id);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  return {
    trip,
    conversationId: conversation.id,
    profile: prefs.profile,
    status: prefs.status,
    provenance: prefs.provenance,
    version: prefs.version,
    completion: completion(prefs.profile, prefs.status),
    messages,
    question: (lastAssistant?.meta?.question as PlannerQuestion | null | undefined) ?? null,
    stage: (lastAssistant?.meta?.stage as string | undefined) ?? "collecting",
    itineraryId: latestItinerarySummary(trip.id)?.id ?? null,
  };
}

/** Extracts structured preferences from one message (live model when configured, rules otherwise). */
export async function extractTripPreferences(actor: Pick<Actor, "key">, profile: TripProfile, lastQuestion: ReturnType<typeof fieldForQuestion>, message: string) {
  return extract(actor, profile, lastQuestion, message);
}

async function extract(actor: Pick<Actor, "key">, profile: TripProfile, lastQuestion: ReturnType<typeof fieldForQuestion>, message: string) {
  const today = new Date();
  const rules = () => extractWithRules(message, { lastQuestion, profile, today });
  const outcome = await runStructured<ExtractionResult>({
    actorKey: actor.key,
    category: "planner",
    tier: "routine",
    system: PLANNER_SYSTEM,
    input: JSON.stringify({ today: today.toISOString().slice(0, 10), lastQuestion, profile: compactProfile(profile), message: message.slice(0, 1500) }),
    schema: LlmExtractionSchema.transform(fromLlmExtraction),
    schemaName: "trip_preferences_update",
    maxOutputTokens: 600,
    fallback: rules,
  });
  return { extraction: outcome.value, source: outcome.source === "mock" ? ("rules" as const) : outcome.source, notice: outcome.notice };
}

/** Handles one customer message: extract → merge → next question → persist → CRM workflow. */
export async function handlePlannerMessage(args: {
  actor: Actor;
  tripId: string;
  message: string;
  clientMessageId?: string | null;
  channel?: "text" | "voice";
}): Promise<PlannerTurnResponse> {
  const { actor } = args;
  const trip = loadTripForActor(actor, args.tripId);
  const conversation = findConversationForTrip(trip.id, "planner") ?? createConversation(actor, "planner", trip.id);

  const { message: userMessage, duplicate } = addMessage(conversation.id, "user", args.message, { channel: args.channel ?? "text" }, args.clientMessageId ?? null);
  if (duplicate) {
    // Retried request: return the reply we already produced instead of calling the AI again.
    const prefs = getPreferences(trip.id)!;
    const reply = replyAfter(conversation.id, userMessage.id);
    return {
      trip: getTripRow(trip.id)!,
      conversationId: conversation.id,
      profile: prefs.profile,
      status: prefs.status,
      provenance: prefs.provenance,
      version: prefs.version,
      completion: completion(prefs.profile, prefs.status),
      turn: {
        reply: reply?.content ?? "",
        question: (reply?.meta?.question as PlannerQuestion | null) ?? null,
        stage: (reply?.meta?.stage as TurnResult["stage"]) ?? "collecting",
        captured: [],
        recommendations: [],
      },
      ai: { source: "rules", notice: null },
      duplicate: true,
    };
  }

  // "Summarise my trip" is answered from the stored profile — no AI call, no state change.
  if (SUMMARY_INTENT.test(args.message)) {
    const prefs = getPreferences(trip.id)!;
    const lastAssistant = [...listMessages(conversation.id)].reverse().find((m) => m.role === "assistant");
    const question = (lastAssistant?.meta?.question as PlannerQuestion | null | undefined) ?? null;
    const recap = summarizeProfile(prefs.profile, prefs.status);
    const reply = [recap ? `Here's your trip so far — ${recap}.` : "We haven't captured any trip details yet.", question?.text].filter(Boolean).join("\n\n");
    addMessage(conversation.id, "assistant", reply, { question, stage: (lastAssistant?.meta?.stage as string | undefined) ?? "collecting", aiSource: "rules", intent: "summary" });
    return {
      trip: getTripRow(trip.id)!,
      conversationId: conversation.id,
      profile: prefs.profile,
      status: prefs.status,
      provenance: prefs.provenance,
      version: prefs.version,
      completion: completion(prefs.profile, prefs.status),
      turn: { reply, question, stage: ((lastAssistant?.meta?.stage as TurnResult["stage"]) ?? "collecting"), captured: [], recommendations: [] },
      ai: { source: "rules", notice: null },
    };
  }

  let turn: TurnResult | null = null;
  let ai: PlannerTurnResponse["ai"] = { source: "rules", notice: null };
  let saved = null;
  let before: TripProfile | null = null;
  const hasItinerary = !!latestItinerarySummary(trip.id);
  const revision = hasItinerary ? detectRevision(args.message) : null;
  // Optimistic concurrency: if a parallel voice/text turn saved first, re-run on fresh state once.
  for (let attempt = 0; attempt < 2 && !saved; attempt++) {
    const prefs = getPreferences(trip.id)!;
    const state = { profile: prefs.profile, status: prefs.status, lastQuestion: prefs.lastQuestion, provenance: prefs.provenance };
    const { extraction, source, notice } = await extract(actor, prefs.profile, fieldForQuestion(prefs.lastQuestion), args.message);
    ai = { source, notice };
    if (revision) {
      // A revision request is an instruction, not a question for a travel expert.
      extraction.sideQuestion = null;
      extraction.sideAnswer = null;
      // Keep only explicit, structured changes; free-text fallbacks (e.g. "answer to the last question") don't apply.
      const keep = new Set(["budgetAmount", "currency", "budgetScope", "budgetIncludesFlights", "startDate", "endDate", "travelMonth", "dateFlexibility", "durationDays", "adults", "children", "childrenAges", "accommodation", "flightClass", "needsFlights"]);
      extraction.updates = Object.fromEntries(Object.entries(extraction.updates).filter(([k]) => keep.has(k)));
      extraction.resolved = [];
      if (revision.pace) extraction.updates.pace = revision.pace;
      if (revision.addInterests) extraction.updates.interests = Array.from(new Set([...prefs.profile.interests, ...revision.addInterests]));
    }
    before = prefs.profile;
    turn = processTurn(state, extraction, args.message);
    try {
      saved = savePlannerState(trip.id, turn.state, prefs.version);
    } catch (e) {
      if (!(e instanceof VersionConflictError) || attempt === 1) throw e;
    }
  }
  if (!turn || !saved) throw new Error("Planner state could not be saved");

  // Itinerary revisions run through the shared tool layer (logged as AI actions).
  const itineraryUpdate = hasItinerary && before ? await reviseItinerary(actor, trip.id, conversation.id, before, saved.profile, revision) : null;
  let reply = turn.reply;
  if (itineraryUpdate?.actions.length) {
    const ack = turn.reply.split("\n\n").filter((part) => /^(Got it|Updated|Heads-up|I've taken)/.test(part)).join("\n\n") || null;
    const follow = turn.question && turn.question.key !== "review" ? turn.question.text : null;
    reply = [ack, ...itineraryUpdate.actions.map((a) => (a.status === "failed" ? `I couldn't do that: ${a.summary}` : a.summary)), follow].filter(Boolean).join("\n\n");
  }

  // Persist the reply, conversation summary and CRM update atomically (one commit).
  const finalTurn = turn;
  const finalSaved = saved;
  const tripRow = tx(() => {
    addMessage(conversation.id, "assistant", reply, {
      question: finalTurn.question,
      stage: finalTurn.stage,
      captured: finalTurn.captured,
      recommendations: finalTurn.recommendations,
      aiSource: ai.source,
      itineraryUpdate,
    });
    updateConversationSummary(conversation.id, summarizeProfile(finalSaved.profile, finalSaved.status));
    const row = getTripRow(trip.id)!;
    syncLead(actor, trip.id, conversation.id, finalTurn.captured.length > 0, undefined, { trip: row, prefs: finalSaved });
    return row;
  });

  return {
    trip: tripRow,
    conversationId: conversation.id,
    profile: saved.profile,
    status: saved.status,
    provenance: saved.provenance,
    version: saved.version,
    completion: completion(saved.profile, saved.status),
    turn: { reply, question: turn.question, stage: turn.stage, captured: turn.captured, recommendations: turn.recommendations, itineraryUpdate },
    ai,
  };
}

export interface ItineraryUpdate {
  itineraryId: string | null;
  version: number | null;
  total: number | null;
  actions: { tool: string; status: string; summary: string }[];
}

/**
 * Decides which tools a revision needs: activity-affecting changes regenerate
 * the plan, cost-only changes re-price it in code, and explicit requests
 * (cheaper, replace/remove an activity, save) map to their own tools.
 */
async function reviseItinerary(
  actor: Actor,
  tripId: string,
  conversationId: string,
  before: TripProfile,
  after: TripProfile,
  revision: RevisionIntent | null,
): Promise<ItineraryUpdate | null> {
  const changed = (keys: readonly (keyof TripProfile)[]) => keys.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const ctx = { actor, source: "planner" as const, conversationId };
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  if (changed(ACTIVITY_FIELDS) || revision?.regenerate) calls.push({ tool: "generate_itinerary", args: { tripId, force: true } });
  else if (changed(COST_FIELDS)) calls.push({ tool: "calculate_trip_budget", args: { tripId } });
  if (revision?.cheaper) calls.push({ tool: "make_itinerary_cheaper", args: { tripId } });
  const current = latestItineraryForTrip(tripId);
  const items = current?.days.flatMap((d) => d.items) ?? [];
  if (revision?.replaceQuery) {
    const item = matchItem(items, revision.replaceQuery);
    calls.push(item ? { tool: "update_itinerary", args: { tripId, edit: { op: "replace", itemId: item.id } } } : { tool: "__unmatched", args: { query: revision.replaceQuery } });
  } else if (revision?.removeQuery) {
    const item = matchItem(items, revision.removeQuery);
    calls.push(item ? { tool: "update_itinerary", args: { tripId, edit: { op: "remove", itemId: item.id } } } : { tool: "__unmatched", args: { query: revision.removeQuery } });
  }
  if (revision?.save) calls.push({ tool: "save_trip", args: { tripId } });
  if (!calls.length) return null;

  const actions: ItineraryUpdate["actions"] = [];
  for (const call of calls) {
    if (call.tool === "__unmatched") {
      actions.push({ tool: "update_itinerary", status: "failed", summary: `I couldn't find “${call.args.query}” in your itinerary — tap Replace on the activity instead.` });
      continue;
    }
    const r = await executeTool(ctx, call.tool, call.args);
    actions.push({ tool: r.tool, status: r.status, summary: r.summary });
  }
  const latest = latestItineraryForTrip(tripId);
  return { itineraryId: latest?.id ?? null, version: latest?.version ?? null, total: latest?.budget.total ?? null, actions };
}

/** Creates/updates the CRM lead once the session has meaningful information. */
export function syncLead(
  actor: Actor,
  tripId: string,
  conversationId: string | null,
  logUpdate: boolean,
  contact?: { name?: string | null; email?: string | null; phone?: string | null },
  preloaded?: { trip: TripRow; prefs: { profile: TripProfile; status: Record<string, string> } },
) {
  const trip = preloaded?.trip ?? getTripRow(tripId)!;
  const prefs = preloaded?.prefs ?? getPreferences(tripId)!;
  if (!qualifiesAsLead(prefs.profile)) return null;
  const itinerary = latestItinerarySummary(tripId);
  const { lead, created } = upsertLeadFromTrip({
    trip,
    profile: prefs.profile,
    conversationId,
    contact: {
      name: contact?.name ?? actor.user?.name ?? null,
      email: contact?.email ?? actor.user?.email ?? null,
      phone: contact?.phone ?? actor.user?.phone ?? null,
    },
    hasItinerary: !!itinerary,
    handoffRequested: !!latestHandoffForTrip(tripId),
    itineraryTotal: itinerary?.total ?? null,
  });
  if (!created && logUpdate) addLeadActivity(lead.id, null, "profile_updated", `Customer updated trip preferences: ${summarizeProfile(prefs.profile, prefs.status as FieldStatus)}`);
  return lead;
}

export type { MessageRecord };
