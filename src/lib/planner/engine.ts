import { getDestination } from "@/lib/catalog/destinations";
import { matchDestination } from "@/lib/catalog/match";
import type { ExtractionResult } from "./extraction";
import { type Provenance,
  ESSENTIAL_FIELDS,
  FIELD_KEYS,
  FIELD_LABELS,
  describeField,
  emptyProfile,
  essentialsResolved,
  formatMonth,
  isAnswered,
  isResolved,
  type FieldKey,
  type FieldStatus,
  type TripProfile,
} from "./profile";
import { recommendDestinations, type DestinationRecommendation } from "./recommend";
import { addDays, daysBetweenInclusive } from "./rules-extractor";

/**
 * Deterministic conversation engine. AI (or the rule extractor) only turns a
 * message into structured updates; choosing the next question, detecting
 * conflicts and writing acknowledgements is ordinary code. This keeps the
 * conversation predictable, avoids repeated questions, and costs nothing.
 */

export type QuestionKey = FieldKey | "conflict:duration" | "conflict:children" | "review";

export interface PlannerState {
  profile: TripProfile;
  status: FieldStatus;
  lastQuestion: QuestionKey | null;
  /** Origin of each answered field (stated / inferred / default / confirmed). */
  provenance?: Provenance;
}

export interface PlannerQuestion {
  key: QuestionKey;
  text: string;
  quickReplies: string[];
  multiSelect?: boolean;
  optional: boolean;
}

export type PlannerStage = "collecting" | "review" | "ready";

export interface TurnResult {
  state: PlannerState;
  reply: string;
  question: PlannerQuestion | null;
  stage: PlannerStage;
  captured: { field: FieldKey; label: string; value: string; corrected: boolean }[];
  recommendations: DestinationRecommendation[];
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Maps a question key to the field the customer is answering (for extractors). */
export function fieldForQuestion(key: QuestionKey | null): FieldKey | null {
  if (!key || key === "review") return null;
  if (key === "conflict:duration") return "duration";
  if (key === "conflict:children") return "travellers";
  return key;
}

function questionFor(field: FieldKey, p: TripProfile): PlannerQuestion {
  const dest = getDestination(p.destinationId);
  const optional = !ESSENTIAL_FIELDS.includes(field);
  switch (field) {
    case "destination": {
      if (p.destinationOpen) {
        const recs = recommendDestinations(p);
        return {
          key: field,
          text: `Based on what you've told me, these could be a great fit: ${recs
            .map((r) => `**${r.name}** (${r.reasons[0].toLowerCase()})`)
            .join(", ")}. Which one should I plan?`,
          quickReplies: recs.map((r) => r.name),
          optional,
        };
      }
      return {
        key: field,
        text: "Where would you like to go? Name a place, or say “not sure” and I'll suggest destinations that fit.",
        quickReplies: ["Bali", "Thailand", "Dubai", "Singapore", "Suggest destinations"],
        optional,
      };
    }
    case "duration":
      return {
        key: field,
        text: `How many days would you like to spend${dest ? ` in ${dest.name}` : ""}?${dest ? ` Most travellers spend ${dest.idealDays[0]}–${dest.idealDays[1]} days.` : ""}`,
        quickReplies: ["4 days", "5 days", "7 days", "10 days", "I don't know yet"],
        optional,
      };
    case "dates": {
      if (p.travelMonth && !p.startDate) {
        return {
          key: field,
          text: `Do you have exact dates in ${formatMonth(p.travelMonth)}, or are you flexible?`,
          quickReplies: ["Flexible within the month", "± a few days", "Fixed dates"],
          optional,
        };
      }
      return {
        key: field,
        text: "When are you thinking of travelling? Exact dates or just a month is fine.",
        quickReplies: nextMonths(3).concat("I don't know yet"),
        optional,
      };
    }
    case "travellers":
      return {
        key: field,
        text:
          p.tripType === "family"
            ? "How many adults and children will be travelling?"
            : "Who's travelling? For example “2 adults” or “2 adults and 2 kids”.",
        quickReplies: p.tripType === "family" ? ["2 adults, 1 child", "2 adults, 2 kids", "4 adults, 2 kids"] : ["Just me", "2 adults", "2 adults, 2 kids", "4 friends"],
        optional,
      };
    case "childrenAges":
      return {
        key: field,
        text: `How old ${p.children === 1 ? "is the child" : "are the children"}? It helps me pick suitable activities.`,
        quickReplies: ["Under 5", "5 and 8", "10 and 13"],
        optional,
      };
    case "departureCity":
      return {
        key: field,
        text: "Which city will you be flying from?",
        quickReplies: ["Chennai", "Bengaluru", "Mumbai", "Delhi", "I'll book flights myself"],
        optional,
      };
    case "budget":
      return {
        key: field,
        text: "What's your approximate budget? Tell me whether it's the total or per person.",
        quickReplies: ["₹1 lakh per person", "₹2.5 lakh total", "₹5 lakh total", "Not sure yet"],
        optional,
      };
    case "budgetIncludesFlights":
      return {
        key: field,
        text: "Does that budget include flights?",
        quickReplies: ["Yes, including flights", "No, excluding flights"],
        optional,
      };
    case "tripType":
      return {
        key: field,
        text: "What kind of trip is this — a family holiday, honeymoon, friends' getaway, or something else?",
        quickReplies: ["Family holiday", "Honeymoon", "Friends' trip", "Solo trip", "Anniversary"],
        optional,
      };
    case "interests":
      return {
        key: field,
        text: "What do you enjoy most on holiday? Pick as many as you like.",
        quickReplies: ["Beaches", "Culture", "Adventure", "Food", "Nature", "Shopping", "Nightlife", "Spa & wellness", "Wildlife"],
        multiSelect: true,
        optional,
      };
    case "pace":
      return {
        key: field,
        text: "What pace suits you — relaxed, balanced, or packed with activities?",
        quickReplies: ["Relaxed", "Balanced", "Packed"],
        optional,
      };
    case "accommodation":
      return {
        key: field,
        text: "What kind of stay do you prefer?",
        quickReplies: ["Budget / 3-star", "Comfortable 4-star", "Luxury 5-star", "Skip"],
        optional,
      };
    case "transport":
      return {
        key: field,
        text: "Should I include flight estimates? If yes, which cabin class?",
        quickReplies: ["Economy", "Premium economy", "Business class", "I'll book flights myself"],
        optional,
      };
    case "requirements":
      return {
        key: field,
        text: "Any dietary needs, accessibility requirements or anything else I should know?",
        quickReplies: ["Vegetarian", "Jain food", "Wheelchair access", "None"],
        optional,
      };
    case "mustSee":
      return {
        key: field,
        text: `Any must-see places or special requests${dest ? ` for ${dest.name}` : ""}?`,
        quickReplies: dest ? dest.activities.slice(0, 3).map((a) => a.title.split(" & ")[0]).concat("Nothing specific") : ["Nothing specific"],
        optional,
      };
  }
}

function nextMonths(n: number): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + 1 + i, 1);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  });
}

/** Asking order. When the customer wants suggestions, destination is asked after we know enough to recommend. */
function askingOrder(p: TripProfile): FieldKey[] {
  if (p.destinationOpen && !p.destinationId) {
    return ["duration", "dates", "travellers", "childrenAges", "budget", "interests", "destination", ...FIELD_KEYS.filter(
      (f) => !["duration", "dates", "travellers", "childrenAges", "budget", "interests", "destination"].includes(f),
    )];
  }
  return [...FIELD_KEYS];
}

export function nextField(p: TripProfile, status: FieldStatus): FieldKey | null {
  return askingOrder(p).find((f) => !isResolved(f, p, status)) ?? null;
}

/** Applies inferences that follow from what the customer said. */
export function normalizeProfile(p: TripProfile): { profile: TripProfile; assumptions: string[] } {
  const next = { ...p };
  const assumptions: string[] = [];
  if ((next.children ?? 0) > 0 && !next.tripType) next.tripType = "family";
  if ((next.tripType === "honeymoon" || next.tripType === "couple") && next.adults === null) {
    next.adults = 2;
    if (next.children === null) next.children = 0;
  }
  if (next.tripType === "solo" && next.adults === null) {
    next.adults = 1;
    next.children = next.children ?? 0;
  }
  if (next.childrenAges.length && (next.children === null || next.children === 0)) next.children = next.childrenAges.length;
  if (next.adults !== null && next.children === null && next.tripType !== "family") next.children = 0;
  if (next.budgetAmount !== null && next.budgetScope === null) {
    next.budgetScope = "total";
    assumptions.push("I've taken that as the total budget — say “per person” if not.");
  }
  if (next.flightClass && next.needsFlights === null) next.needsFlights = true;
  if (next.startDate && next.endDate && next.endDate < next.startDate) {
    [next.startDate, next.endDate] = [next.endDate, next.startDate];
  }
  if (next.startDate && !next.endDate && next.durationDays) next.endDate = addDays(next.startDate, next.durationDays - 1);
  if (next.startDate && next.endDate && next.durationDays === null) next.durationDays = Math.min(60, daysBetweenInclusive(next.startDate, next.endDate));
  if (next.startDate) next.travelMonth = next.startDate.slice(0, 7);
  if (next.startDate && next.endDate && next.dateFlexibility === null) next.dateFlexibility = "fixed";
  return { profile: next, assumptions };
}

export function initialTurn(): TurnResult {
  const state: PlannerState = { profile: emptyProfile(), status: {}, lastQuestion: "destination" };
  const q = questionFor("destination", state.profile);
  return {
    state,
    reply:
      "Hi! I'm your AI trip planner. Tell me about the trip you have in mind — for example “a 5-day family trip to Bali in December” — and I'll only ask for what's missing.",
    question: q,
    stage: "collecting",
    captured: [],
    recommendations: [],
  };
}

const FIELD_FOR_KEY: Partial<Record<keyof TripProfile, FieldKey>> = {
  destinationId: "destination", destinationName: "destination", destinationOpen: "destination",
  departureCity: "departureCity", startDate: "dates", endDate: "dates", travelMonth: "dates", dateFlexibility: "dates",
  durationDays: "duration", adults: "travellers", children: "travellers", childrenAges: "childrenAges",
  tripType: "tripType", occasion: "tripType", interests: "interests", pace: "pace", budgetAmount: "budget",
  currency: "budget", budgetScope: "budget", budgetIncludesFlights: "budgetIncludesFlights",
  accommodation: "accommodation", needsFlights: "transport", flightClass: "transport", dietary: "requirements",
  accessibility: "requirements", mustSee: "mustSee", specialRequests: "mustSee",
};

/**
 * Applies a direct edit from the progress panel (not via chat). Uses the same
 * normalisation so chat, voice and manual edits share one profile.
 */
export function applyManualEdit(state: PlannerState, updates: Partial<TripProfile>, clear: FieldKey[] = []): PlannerState {
  const status = { ...state.status };
  const provenance: Provenance = { ...(state.provenance ?? {}) };
  let profile = { ...state.profile, ...updates };
  for (const key of Object.keys(updates) as (keyof TripProfile)[]) {
    const f = FIELD_FOR_KEY[key];
    if (f) {
      delete status[f];
      // Edited directly in the Trip Profile: the customer has confirmed this value.
      provenance[f] = "confirmed";
    }
  }
  if (updates.destinationId) {
    const d = getDestination(updates.destinationId);
    profile.destinationName = d?.name ?? profile.destinationName;
    profile.destinationOpen = false;
  }
  for (const f of clear) {
    profile = clearField(profile, f);
    delete status[f];
    delete provenance[f];
  }
  return { ...state, profile: normalizeProfile(profile).profile, status, provenance };
}

function clearField(p: TripProfile, f: FieldKey): TripProfile {
  const n = { ...p };
  switch (f) {
    case "destination": n.destinationId = null; n.destinationName = null; n.destinationOpen = false; break;
    case "duration": n.durationDays = null; break;
    case "dates": n.startDate = null; n.endDate = null; n.travelMonth = null; n.dateFlexibility = null; break;
    case "travellers": n.adults = null; n.children = null; break;
    case "childrenAges": n.childrenAges = []; break;
    case "departureCity": n.departureCity = null; break;
    case "budget": n.budgetAmount = null; n.budgetScope = null; break;
    case "budgetIncludesFlights": n.budgetIncludesFlights = null; break;
    case "tripType": n.tripType = null; n.occasion = null; break;
    case "interests": n.interests = []; break;
    case "pace": n.pace = null; break;
    case "accommodation": n.accommodation = null; break;
    case "transport": n.needsFlights = null; n.flightClass = null; break;
    case "requirements": n.dietary = []; n.accessibility = null; break;
    case "mustSee": n.mustSee = []; n.specialRequests = null; break;
  }
  return n;
}

export function processTurn(
  state: PlannerState,
  extraction: ExtractionResult,
  message: string,
  today: Date = new Date(),
): TurnResult {
  const prev = state.profile;
  let profile: TripProfile = { ...prev };
  const status: FieldStatus = { ...state.status };
  const provenance: Provenance = { ...(state.provenance ?? {}) };
  const statedNow = new Set<FieldKey>();
  const notes: string[] = [];
  const text = message.toLowerCase();
  const u = { ...extraction.updates };

  // 1. Destination: map to catalog; unsupported names get an honest note.
  if (u.destinationId || u.destinationName) {
    const d = getDestination(u.destinationId) ?? matchDestination(u.destinationName);
    if (d) {
      profile.destinationId = d.id;
      profile.destinationName = d.name;
      profile.destinationOpen = false;
      delete status.destination;
      statedNow.add("destination");
    } else if (u.destinationName) {
      notes.push(
        `I don't have detailed demo content for **${u.destinationName}** yet. I can currently plan Bali, Thailand, Dubai, Singapore, Maldives, Switzerland, Vietnam and Japan — or I can suggest one.`,
      );
    }
  }
  delete u.destinationId;
  delete u.destinationName;
  delete u.destinationOpen;

  // 2. Resolve the duration-vs-dates conflict using the customer's answer.
  if (state.lastQuestion === "conflict:duration" && prev.startDate) {
    if (u.durationDays) {
      u.endDate = addDays(prev.startDate, u.durationDays - 1);
    } else if (/\b(keep|dates|first|yes)\b/.test(text) && prev.endDate) {
      u.durationDays = daysBetweenInclusive(prev.startDate, prev.endDate);
    }
  }
  if (state.lastQuestion === "conflict:children") {
    if (u.children !== undefined && !u.childrenAges && prev.childrenAges.length !== u.children) u.childrenAges = [];
    if (u.childrenAges && u.children === undefined) u.children = u.childrenAges.length;
  }
  // A new duration with existing exact dates (and no new dates) keeps the start date.
  if (u.durationDays && prev.startDate && !u.startDate && state.lastQuestion !== "conflict:duration" && !prev.endDate) {
    u.endDate = addDays(prev.startDate, u.durationDays - 1);
  }

  // 3. Apply remaining updates and clear any "unknown/skipped" marker they answer.
  for (const [key, value] of Object.entries(u) as [keyof TripProfile, never][]) {
    if (value === undefined) continue;
    (profile as Record<string, unknown>)[key] = value;
    const f = FIELD_FOR_KEY[key];
    if (f) {
      delete status[f];
      statedNow.add(f);
    }
  }

  if (extraction.wantsRecommendations && !profile.destinationId) {
    profile.destinationOpen = true;
    delete status.destination;
  }

  // 4. Explicit "I don't know" / skip / none markers.
  for (const r of extraction.resolved) {
    if (isAnswered(r.field, profile)) continue;
    if (r.field === "destination") {
      profile.destinationOpen = true;
      continue;
    }
    status[r.field] = ESSENTIAL_FIELDS.includes(r.field) && r.status === "skipped" ? "unknown" : r.status;
  }

  // 5. Inferences.
  const beforeNormalize = profile;
  const normalized = normalizeProfile(profile);
  profile = normalized.profile;
  for (const f of statedNow) provenance[f] = extraction.inferred?.includes(f) && provenance[f] !== "confirmed" ? "inferred" : "stated";
  for (const key of Object.keys(profile) as (keyof TripProfile)[]) {
    const f = FIELD_FOR_KEY[key];
    if (!f || statedNow.has(f) || JSON.stringify(profile[key]) === JSON.stringify(beforeNormalize[key])) continue;
    // e.g. children given → trip type "family"; "honeymoon" → 2 adults; budget scope assumed "total".
    if (provenance[f] !== "confirmed" && provenance[f] !== "stated") provenance[f] = key === "budgetScope" ? "default" : "inferred";
  }
  for (const r of extraction.resolved) if (!isAnswered(r.field, profile)) delete provenance[r.field];
  if (normalized.assumptions.length && prev.budgetAmount === null && profile.budgetAmount !== null) notes.push(...normalized.assumptions);

  // 6. Validation: past dates.
  const todayIso = today.toISOString().slice(0, 10);
  if (profile.startDate && profile.startDate < todayIso) {
    notes.push("That date has already passed, so I've cleared it.");
    profile.startDate = null;
    profile.endDate = null;
    profile.travelMonth = null;
    profile.dateFlexibility = null;
  }

  // 7. Seasonality advice (deterministic, from the catalog).
  const dest = getDestination(profile.destinationId);
  const monthChanged = profile.travelMonth !== prev.travelMonth || profile.destinationId !== prev.destinationId;
  if (dest && profile.travelMonth && monthChanged) {
    const m = Number(profile.travelMonth.slice(5, 7));
    if (!dest.bestMonths.includes(m)) {
      notes.push(
        `Heads-up: ${MONTH_NAMES[m - 1]} is outside the usual best season for ${dest.name} (${dest.bestMonths.map((x) => MONTH_NAMES[x - 1].slice(0, 3)).join(", ")}). It's still doable — I'll plan with the weather in mind.`,
      );
    }
  }

  // 8. Captured / corrected fields for the acknowledgement.
  const captured: TurnResult["captured"] = [];
  for (const f of FIELD_KEYS) {
    const before = describeField(f, prev, state.status);
    const after = describeField(f, profile, status);
    if (after && after !== before && (isAnswered(f, profile) || (f === "dates" && profile.travelMonth))) {
      captured.push({ field: f, label: FIELD_LABELS[f], value: after, corrected: !!before && isAnswered(f, prev) });
    }
  }

  // 9. Side question answers.
  let sideAnswer = extraction.sideAnswer;
  if (extraction.sideQuestion && !sideAnswer) sideAnswer = deterministicSideAnswer(extraction.sideQuestion, profile);

  // 10. Conflicts take priority over the next question.
  const nextState: PlannerState = { profile, status, lastQuestion: null, provenance };
  let question: PlannerQuestion | null = null;
  let stage: PlannerStage = "collecting";

  const conflict = detectConflict(profile);
  if (conflict) {
    question = conflict;
  } else {
    const field = nextField(profile, status);
    const confirmsReview = state.lastQuestion === "review" && /\b(yes|yeah|sure|ok|okay|go|generate|looks good|perfect)\b/.test(text);
    if ((extraction.wantsToGenerate || confirmsReview) && essentialsResolved(profile, status)) {
      stage = "ready";
      // The customer has seen the summary and confirmed it.
      for (const f of FIELD_KEYS) if (isAnswered(f, profile)) provenance[f] = "confirmed";
    } else if (field) {
      question = questionFor(field, profile);
    } else {
      stage = "review";
      question = {
        key: "review",
        text: reviewText(profile, status),
        quickReplies: ["Generate my itinerary", "Change something"],
        optional: false,
      };
    }
  }
  // An unparseable answer to an optional question: skip it rather than asking again.
  const unparsed = !captured.length && !extraction.resolved.length && !notes.length && !sideAnswer && !!question && question.key === state.lastQuestion && stage === "collecting";
  let skippedUnparsed = false;
  if (unparsed && question?.optional && (FIELD_KEYS as readonly string[]).includes(question.key)) {
    status[question.key as FieldKey] = "skipped";
    skippedUnparsed = true;
    const next = nextField(profile, status);
    question = next
      ? questionFor(next, profile)
      : { key: "review", text: reviewText(profile, status), quickReplies: ["Generate my itinerary", "Change something"], optional: false };
    if (!next) stage = "review";
  }
  nextState.lastQuestion = question?.key ?? null;

  const parts: string[] = [];
  const corrected = captured.filter((c) => c.corrected);
  const fresh = captured.filter((c) => !c.corrected);
  if (fresh.length) parts.push(`Got it — ${fresh.map((c) => c.value).join(" · ")}.`);
  if (corrected.length) parts.push(`Updated ${corrected.map((c) => `${c.label.toLowerCase()} to ${c.value}`).join(", ")}.`);
  if (!captured.length && extraction.resolved.length) {
    const kinds = new Set(extraction.resolved.map((r) => r.status));
    parts.push(kinds.has("unknown") ? "No problem — we can sort that out later." : kinds.has("none") ? "Noted." : "Okay, skipping that.");
  }
  parts.push(...notes);
  if (sideAnswer) parts.push(sideAnswer);
  if (stage === "ready") parts.push("Great — I'm putting together your itinerary now.");
  if (question) parts.push(question.text);
  if (skippedUnparsed) parts.unshift("Sorry, I didn't quite catch that — I'll leave it for now. You can set it any time in your trip profile.");
  else if (unparsed) parts.unshift("Sorry, I didn't quite catch that.");

  return {
    state: nextState,
    reply: parts.join("\n\n"),
    question,
    stage,
    captured,
    recommendations: profile.destinationOpen && !profile.destinationId ? recommendDestinations(profile) : [],
  };
}

function detectConflict(p: TripProfile): PlannerQuestion | null {
  if (p.startDate && p.endDate && p.durationDays) {
    const span = daysBetweenInclusive(p.startDate, p.endDate);
    if (span !== p.durationDays) {
      return {
        key: "conflict:duration",
        text: `Your dates cover ${span} days, but you mentioned ${p.durationDays} days. Which should I use?`,
        quickReplies: [`Keep the dates (${span} days)`, `${p.durationDays} days`],
        optional: false,
      };
    }
  }
  if ((p.children ?? 0) > 0 && p.childrenAges.length > 0 && p.childrenAges.length !== p.children) {
    return {
      key: "conflict:children",
      text: `You mentioned ${p.children} child${p.children === 1 ? "" : "ren"} but gave ${p.childrenAges.length} age${p.childrenAges.length === 1 ? "" : "s"} (${p.childrenAges.join(", ")}). How many children are travelling?`,
      quickReplies: [`${p.childrenAges.length} children`, `${p.children} children`],
      optional: false,
    };
  }
  return null;
}

function deterministicSideAnswer(question: string, p: TripProfile): string {
  const q = question.toLowerCase();
  const d = getDestination(p.destinationId);
  if (d && /\b(best time|when (to|should)|weather|season|rain|monsoon|hot|cold)\b/.test(q)) {
    return `The usual best months for ${d.name} are ${d.bestMonths.map((m) => MONTH_NAMES[m - 1]).join(", ")} (general guidance, not a forecast).`;
  }
  if (d && /\bvisa\b/.test(q)) return d.visaNote;
  return "Good question — I've noted it for your travel expert, who will follow up with an accurate answer.";
}

/** Short summary used as the conversation's compact memory and in CRM notes. */
/** Short spoken/written recap of the key details, used before generating. */
export function tripRecap(p: TripProfile, status: FieldStatus): string {
  const parts = (["destination", "duration", "dates", "travellers", "budget", "pace", "accommodation"] as FieldKey[])
    .map((f) => describeField(f, p, status))
    .filter(Boolean);
  return parts.join(" · ");
}

function reviewText(p: TripProfile, status: FieldStatus): string {
  const recap = tripRecap(p, status);
  return recap ? `Here's what I have: ${recap}. Shall I generate your day-by-day itinerary, or would you like to change anything?` : "That's everything I need. Shall I generate your day-by-day itinerary?";
}

export function summarizeProfile(p: TripProfile, status: FieldStatus): string {
  return FIELD_KEYS.map((f) => {
    const v = describeField(f, p, status);
    return v ? `${FIELD_LABELS[f]}: ${v}` : null;
  })
    .filter(Boolean)
    .join("; ");
}
