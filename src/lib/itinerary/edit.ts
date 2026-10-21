import { z } from "zod";
import type { CatalogActivity, Destination } from "@/lib/catalog/types";
import type { TripProfile } from "@/lib/planner/profile";
import { activityGroupCost, computeBudget, party, selectHotel } from "./budget";
import { buildDays, dayTitle, explainActivity, isSuitable, planSingleDay, scoreActivity, uid } from "./generate";
import type { Itinerary, ItineraryDay, ItineraryItem } from "./types";

/**
 * Deterministic itinerary edits. Each operation changes only the affected
 * day(s) and recomputes the budget in code. No AI call is needed.
 */

export const ItineraryEditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("remove"), itemId: z.string().min(1) }),
  z.object({ op: z.literal("replace"), itemId: z.string().min(1), catalogRef: z.string().min(1).optional() }),
  z.object({ op: z.literal("move"), itemId: z.string().min(1), direction: z.enum(["up", "down"]) }),
  z.object({ op: z.literal("moveToDay"), itemId: z.string().min(1), dayNumber: z.number().int().min(1) }),
  z.object({ op: z.literal("add"), dayNumber: z.number().int().min(1), catalogRef: z.string().min(1) }),
  z.object({ op: z.literal("regenerateDay"), dayNumber: z.number().int().min(1) }),
  z.object({ op: z.literal("setHotelTier"), tier: z.enum(["budget", "midrange", "luxury"]) }),
]);
export type ItineraryEdit = z.infer<typeof ItineraryEditSchema>;

export class EditError extends Error {
  constructor(message: string, readonly code: "not_found" | "invalid") {
    super(message);
  }
}

function clone(it: Itinerary): Itinerary {
  return structuredClone(it);
}

function locate(it: Itinerary, itemId: string): { day: ItineraryDay; index: number; item: ItineraryItem } {
  for (const day of it.days) {
    const index = day.items.findIndex((i) => i.id === itemId);
    if (index >= 0) return { day, index, item: day.items[index] };
  }
  throw new EditError("Itinerary item not found", "not_found");
}

function usedRefs(it: Itinerary): Set<string> {
  return new Set(it.days.flatMap((d) => d.items.map((i) => i.catalogRef).filter((r): r is string => !!r)));
}

function toItem(a: CatalogActivity, p: TripProfile, area: string | null): ItineraryItem {
  return {
    id: uid("itm"),
    kind: "activity",
    catalogRef: a.id,
    title: a.title,
    description: a.description,
    area: a.area,
    durationHours: a.hours,
    estCost: activityGroupCost(a, party(p)),
    reason: explainActivity(a, p, area),
  };
}

function retitle(day: ItineraryDay, total: number, d: Destination) {
  const acts = day.items
    .filter((i) => i.kind === "activity" && i.catalogRef)
    .map((i) => d.activities.find((a) => a.id === i.catalogRef))
    .filter((a): a is CatalogActivity => !!a);
  day.title = dayTitle(day.dayNumber, total, acts);
  day.area = acts[0]?.area ?? null;
}

/** Suitable, unused catalog activities ranked as replacements for an item. */
export function alternativesFor(it: Itinerary, d: Destination, p: TripProfile, itemId?: string, limit = 4): CatalogActivity[] {
  const used = usedRefs(it);
  const current = itemId ? d.activities.find((a) => a.id === locate(it, itemId).item.catalogRef) : undefined;
  return d.activities
    .filter((a) => !used.has(a.id) && isSuitable(a, p))
    .map((a) => {
      let s = scoreActivity(a, p, d);
      if (current) {
        if (a.area === current.area) s += 2;
        if (Math.abs(a.hours - current.hours) <= 2) s += 1;
        s += a.tags.filter((t) => current.tags.includes(t)).length;
      }
      return { a, s };
    })
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map((x) => x.a);
}

export function applyEdit(
  original: Itinerary,
  edit: ItineraryEdit,
  d: Destination,
  p: TripProfile,
): { itinerary: Itinerary; description: string; affectedDays: number[] } {
  const it = clone(original);
  const total = it.days.length;
  let description = "";
  let affected: number[] = [];

  switch (edit.op) {
    case "remove": {
      const { day, index, item } = locate(it, edit.itemId);
      if (item.kind === "transfer") throw new EditError("Airport transfers can't be removed", "invalid");
      day.items.splice(index, 1);
      retitle(day, total, d);
      description = `Removed “${item.title}” from day ${day.dayNumber}`;
      affected = [day.dayNumber];
      break;
    }
    case "replace": {
      const { day, index, item } = locate(it, edit.itemId);
      if (item.kind !== "activity") throw new EditError("Only activities can be replaced", "invalid");
      const used = usedRefs(it);
      const replacement = edit.catalogRef
        ? d.activities.find((a) => a.id === edit.catalogRef)
        : alternativesFor(it, d, p, edit.itemId, 1)[0];
      if (!replacement) throw new EditError("No suitable alternative is available", "not_found");
      if (used.has(replacement.id)) throw new EditError("That activity is already in the itinerary", "invalid");
      if (!isSuitable(replacement, p)) throw new EditError("That activity isn't suitable for this group", "invalid");
      day.items[index] = toItem(replacement, p, day.area);
      retitle(day, total, d);
      description = `Replaced “${item.title}” with “${replacement.title}” on day ${day.dayNumber}`;
      affected = [day.dayNumber];
      break;
    }
    case "move": {
      const { day, index, item } = locate(it, edit.itemId);
      const target = edit.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= day.items.length) throw new EditError("Can't move further", "invalid");
      [day.items[index], day.items[target]] = [day.items[target], day.items[index]];
      description = `Moved “${item.title}” ${edit.direction} on day ${day.dayNumber}`;
      affected = [day.dayNumber];
      break;
    }
    case "moveToDay": {
      const { day, index, item } = locate(it, edit.itemId);
      const targetDay = it.days.find((x) => x.dayNumber === edit.dayNumber);
      if (!targetDay) throw new EditError("Day not found", "not_found");
      if (item.kind !== "activity") throw new EditError("Only activities can be moved between days", "invalid");
      if (targetDay === day) throw new EditError("The activity is already on that day", "invalid");
      day.items.splice(index, 1);
      const lastTransfer = targetDay.items.findIndex((i, k) => i.kind === "transfer" && k > 0);
      targetDay.items.splice(lastTransfer >= 0 ? lastTransfer : targetDay.items.length, 0, item);
      retitle(day, total, d);
      retitle(targetDay, total, d);
      description = `Moved “${item.title}” to day ${edit.dayNumber}`;
      affected = [day.dayNumber, edit.dayNumber];
      break;
    }
    case "add": {
      const targetDay = it.days.find((x) => x.dayNumber === edit.dayNumber);
      if (!targetDay) throw new EditError("Day not found", "not_found");
      const activity = d.activities.find((a) => a.id === edit.catalogRef);
      if (!activity) throw new EditError("Activity not found", "not_found");
      if (usedRefs(it).has(activity.id)) throw new EditError("That activity is already in the itinerary", "invalid");
      if (!isSuitable(activity, p)) throw new EditError("That activity isn't suitable for this group", "invalid");
      const lastTransfer = targetDay.items.findIndex((i, k) => i.kind === "transfer" && k > 0);
      targetDay.items = targetDay.items.filter((i) => i.kind !== "free_time");
      targetDay.items.splice(lastTransfer >= 0 ? Math.min(lastTransfer, targetDay.items.length) : targetDay.items.length, 0, toItem(activity, p, targetDay.area));
      retitle(targetDay, total, d);
      description = `Added “${activity.title}” to day ${edit.dayNumber}`;
      affected = [edit.dayNumber];
      break;
    }
    case "regenerateDay": {
      const index = it.days.findIndex((x) => x.dayNumber === edit.dayNumber);
      if (index < 0) throw new EditError("Day not found", "not_found");
      const old = it.days[index];
      // Keep every other day intact; re-plan this day from unused activities.
      const otherRefs = new Set(it.days.filter((_, i) => i !== index).flatMap((x) => x.items.map((i) => i.catalogRef).filter((r): r is string => !!r)));
      const oldRefs = old.items.map((i) => i.catalogRef).filter((r): r is string => !!r);
      let plan = planSingleDay(d, p, edit.dayNumber, new Set([...otherRefs, ...oldRefs]));
      if (!plan.activityIds.length) plan = planSingleDay(d, p, edit.dayNumber, otherRefs);
      const plans = it.days.map((_, i) => (i === index ? plan : { activityIds: [] }));
      const rebuilt = buildDays(d, p, plans)[index];
      it.days[index] = { ...rebuilt, id: old.id, date: old.date };
      description = `Regenerated day ${edit.dayNumber}`;
      affected = [edit.dayNumber];
      break;
    }
    case "setHotelTier": {
      it.hotel = selectHotel(d, edit.tier, p);
      description = `Changed stay to ${it.hotel.name}`;
      affected = [];
      break;
    }
  }

  it.budget = computeBudget(d, p, it.days, it.hotel, it.transport);
  it.updatedAt = new Date().toISOString();
  return { itinerary: it, description, affectedDays: affected };
}
