import { z } from "zod";
import { parseQuery, route } from "@/lib/http";
import { INTERESTS } from "@/lib/catalog/types";
import { emptyProfile } from "@/lib/planner/profile";
import { recommendDestinations } from "@/lib/planner/recommend";
import { getPreferences } from "@/lib/repos/trips";
import { loadTripForActor } from "@/lib/services/planner";

const QuerySchema = z.object({
  tripId: z.string().max(64).optional(),
  interests: z.string().max(200).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  budget: z.coerce.number().int().positive().optional(),
  travellers: z.coerce.number().int().min(1).max(30).optional(),
  days: z.coerce.number().int().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(8).optional(),
});

/** Deterministic destination scoring (interests, season, budget fit, family suitability). */
export const GET = route({}, ({ req, actor }) => {
  const q = parseQuery(req, QuerySchema);
  let profile = emptyProfile();
  if (q.tripId) {
    loadTripForActor(actor, q.tripId);
    profile = getPreferences(q.tripId)?.profile ?? profile;
  } else {
    const year = new Date().getFullYear();
    profile = {
      ...profile,
      interests: (q.interests?.split(",") ?? []).filter((i): i is (typeof INTERESTS)[number] => (INTERESTS as readonly string[]).includes(i)),
      travelMonth: q.month ? `${year}-${String(q.month).padStart(2, "0")}` : null,
      budgetAmount: q.budget ?? null,
      budgetScope: q.budget ? "total" : null,
      adults: q.travellers ?? null,
      children: q.travellers ? 0 : null,
      durationDays: q.days ?? null,
    };
  }
  return { items: recommendDestinations(profile, q.limit ?? 3), basis: "deterministic scoring on demo catalog data" };
});
