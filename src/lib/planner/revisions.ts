import type { Interest } from "@/lib/catalog/types";

/**
 * Deterministic detection of itinerary revision requests in the planner chat
 * ("make it slower", "cheaper options", "replace the water park", "save my trip").
 * Executing them is done by tools in the planner service.
 */
export interface RevisionIntent {
  pace?: "relaxed" | "packed";
  addInterests?: Interest[];
  cheaper?: boolean;
  save?: boolean;
  regenerate?: boolean;
  replaceQuery?: string;
  removeQuery?: string;
}

export function detectRevision(message: string): RevisionIntent | null {
  const t = message.toLowerCase().replace(/[’`]/g, "'");
  const r: RevisionIntent = {};
  if (/\b(slower|slow (it )?down|less (rushed|packed|hectic|busy)|more relax(ed|ing)|fewer activities|more free time|take it easy|too (packed|busy|rushed|hectic))\b/.test(t)) r.pace = "relaxed";
  if (/\b(more adventur\w*|adventurous|more active|more thrill\w*|add (some )?adventure|more exciting|more activities|busier|pack (it|more) in|faster pace)\b/.test(t)) {
    r.pace = "packed";
    if (/adventur|thrill|exciting|active/.test(t)) r.addInterests = ["adventure"];
  }
  if (/\b(more|add|extra|additional)\b.*\bcultur(e|al)\b|\bcultural experiences?\b/.test(t)) r.addInterests = [...(r.addInterests ?? []), "culture"];
  if (/\b(family[- ]friendly|kid[- ]friendly|child[- ]friendly|for (the )?(kids|children))\b/.test(t)) r.addInterests = [...(r.addInterests ?? []), "family_fun"];
  if (/\b(cheaper|less expensive|lower (the )?(cost|price|total)|cut (the )?costs?|save (some )?money|budget[- ]friendly|reduce (the )?(cost|price|total)|too expensive|more affordable|cheaper alternatives?)\b/.test(t)) r.cheaper = true;
  if (/\b(save (my |the |this )?(trip|plan|itinerary)|save it|keep (this|it) for later)\b/.test(t)) r.save = true;
  if (/\b(regenerate|redo|re-?plan|new itinerary|different itinerary|start (the itinerary )?over)\b/.test(t)) r.regenerate = true;
  const replace = /\b(?:replace|swap|switch out)\s+(?:the\s+)?(.{3,60}?)(?:\s+(?:with|for)\b.*)?\s*[.?!]*$/.exec(t);
  if (replace) r.replaceQuery = replace[1].trim();
  const remove = /\b(?:remove|drop|skip|cut|take out)\s+(?:the\s+)?(.{3,60}?)\s*(?:from (?:the |my )?(?:plan|itinerary|trip))?\s*[.?!]*$/.exec(t);
  if (remove && !/\b(cost|price|money)\b/.test(remove[1])) r.removeQuery = remove[1].trim();
  return Object.keys(r).length ? r : null;
}

/** Fuzzy match an activity title from a customer's words ("the water park" → "Waterbom Bali water park"). */
export function matchItem<T extends { title: string; kind: string }>(items: T[], query: string): T | undefined {
  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !["the", "and", "day", "activity", "one", "that", "this"].includes(w));
  if (!words.length) return undefined;
  let best: { item: T; score: number } | undefined;
  for (const item of items.filter((i) => i.kind === "activity")) {
    const title = item.title.toLowerCase();
    const score = words.filter((w) => title.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item;
}

export const ACTIVITY_FIELDS = ["destinationId", "durationDays", "adults", "children", "childrenAges", "interests", "pace", "mustSee", "accessibility", "tripType"] as const;
export const COST_FIELDS = ["budgetAmount", "currency", "budgetScope", "budgetIncludesFlights", "accommodation", "needsFlights", "flightClass", "departureCity", "startDate", "endDate"] as const;
