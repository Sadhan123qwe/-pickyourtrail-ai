import { z } from "zod";
import { forbidden, notFound, parseBody, route, type Actor } from "@/lib/http";
import { ownsRecord } from "@/lib/auth/permissions";
import { FIELD_KEYS, TripProfileSchema, completion } from "@/lib/planner/profile";
import { applyManualEdit, nextField, summarizeProfile } from "@/lib/planner/engine";
import { getPreferences, getPreferencesById, savePlannerState, VersionConflictError } from "@/lib/repos/trips";
import { addMessage, findConversationForTrip } from "@/lib/repos/conversations";
import { ApiError } from "@/lib/http";
import { loadTripForActor, plannerSnapshot, syncLead } from "@/lib/services/planner";

/** Accepts either a preferences id or a trip id. */
function resolve(actor: Actor, id: string) {
  const prefs = getPreferencesById(id) ?? getPreferences(id);
  if (!prefs) throw notFound("Trip preferences not found");
  const trip = loadTripForActor(actor, prefs.tripId);
  return { prefs, trip };
}

export const GET = route<{ id: string }>({}, ({ actor, params }) => {
  const { trip } = resolve(actor, params.id);
  return plannerSnapshot(actor, trip.id);
});

const PatchSchema = z.object({
  updates: TripProfileSchema.partial().default({}),
  clear: z.array(z.enum(FIELD_KEYS)).max(15).default([]),
  expectedVersion: z.number().int().optional(),
});

/** Direct edits from the progress panel or review page; shares the chat's profile and rules. */
export const PATCH = route<{ id: string }>({}, async ({ req, actor, params }) => {
  const { prefs, trip } = resolve(actor, params.id);
  if (!ownsRecord(actor, trip)) throw forbidden("Only the trip owner can edit preferences");
  const body = await parseBody(req, PatchSchema);
  const state = applyManualEdit({ profile: prefs.profile, status: prefs.status, lastQuestion: prefs.lastQuestion, provenance: prefs.provenance }, body.updates, body.clear);
  state.lastQuestion = nextField(state.profile, state.status) ?? "review";
  let saved;
  try {
    saved = savePlannerState(trip.id, state, body.expectedVersion ?? prefs.version);
  } catch (e) {
    if (e instanceof VersionConflictError) throw new ApiError(409, "version_conflict", e.message);
    throw e;
  }
  const conv = findConversationForTrip(trip.id, "planner");
  if (conv) addMessage(conv.id, "system", `Preferences edited directly: ${summarizeProfile(saved.profile, saved.status)}`);
  syncLead(actor, trip.id, conv?.id ?? null, true);
  return { tripId: trip.id, profile: saved.profile, status: saved.status, version: saved.version, completion: completion(saved.profile, saved.status) };
});
