import { z } from "zod";
import { parseBody, route } from "@/lib/http";
import { can } from "@/lib/auth/permissions";
import { completion } from "@/lib/planner/profile";
import { summarizeProfile } from "@/lib/planner/engine";
import { latestHandoffForTrip } from "@/lib/repos/handoffs";
import { latestItineraryForTrip } from "@/lib/repos/itineraries";
import { leadForTrip } from "@/lib/repos/leads";
import { getPreferences } from "@/lib/repos/trips";
import { listAudit } from "@/lib/repos/audit";
import { loadTripForActor } from "@/lib/services/planner";
import { findConversationForTrip, listMessages } from "@/lib/repos/conversations";

/** Employees see a compact view of the planning conversation (summary + latest customer messages). */
function conversationContext(tripId: string) {
  const conv = findConversationForTrip(tripId, "planner");
  if (!conv) return null;
  const messages = listMessages(conv.id);
  return {
    id: conv.id,
    summary: conv.summary,
    messageCount: messages.length,
    recent: messages.filter((m) => m.role !== "system").slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 400), createdAt: m.createdAt })),
  };
}
import { updateTripAsOwner } from "@/lib/services/trips";

export const GET = route<{ id: string }>({}, ({ actor, params }) => {
  const trip = loadTripForActor(actor, params.id);
  const prefs = getPreferences(trip.id)!;
  const employee = can(actor.role, "trips:read_all");
  return {
    trip,
    profile: prefs.profile,
    status: prefs.status,
    version: prefs.version,
    completion: completion(prefs.profile, prefs.status),
    summary: summarizeProfile(prefs.profile, prefs.status),
    itinerary: latestItineraryForTrip(trip.id) ?? null,
    handoff: latestHandoffForTrip(trip.id) ?? null,
    // Internal CRM and audit details are only visible to employees.
    lead: employee ? (leadForTrip(trip.id) ?? null) : undefined,
    audit: employee && can(actor.role, "audit:read") ? listAudit({ entityId: trip.id, limit: 20 }) : undefined,
    conversation: employee ? conversationContext(trip.id) : undefined,
  };
});

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["saved", "cancelled"]).optional(),
  contact: z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      email: z.email().max(120).optional(),
      phone: z.string().trim().max(20).optional(),
    })
    .optional(),
});

export const PATCH = route<{ id: string }>({}, async ({ req, actor, params }) => {
  const body = await parseBody(req, PatchSchema);
  return { trip: updateTripAsOwner(actor, params.id, body) };
});
