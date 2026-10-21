import { z } from "zod";
import { ApiError, badRequest, conflict, notFound, parseBody, requirePermission, route } from "@/lib/http";
import { LEAD_STAGES, allowedLeadTransitions } from "@/lib/workflows/rules";
import { LeadError, getLead, leadPreferencesSummary, listFollowUps, listLeadActivities, updateLead } from "@/lib/repos/leads";
import { getPreferences } from "@/lib/repos/trips";
import { latestItineraryForTrip } from "@/lib/repos/itineraries";
import { getUser } from "@/lib/repos/users";
import { findConversationForTrip } from "@/lib/repos/conversations";
import { suggestNextAction } from "@/lib/workflows/next-action";

export const GET = route<{ id: string }>({}, ({ actor, params }) => {
  requirePermission(actor, "leads:read");
  const lead = getLead(params.id);
  if (!lead) throw notFound("Lead not found");
  const prefs = lead.trip_id ? getPreferences(lead.trip_id) : undefined;
  const itinerary = lead.trip_id ? latestItineraryForTrip(lead.trip_id) : undefined;
  return {
    lead,
    allowedTransitions: allowedLeadTransitions(lead.stage),
    preferences: prefs ? { profile: prefs.profile, summary: leadPreferencesSummary(lead) } : null,
    itinerary: itinerary ? { id: itinerary.id, version: itinerary.version, total: itinerary.budget.total, days: itinerary.days.length, summary: itinerary.summary } : null,
    activities: listLeadActivities(lead.id),
    conversation: lead.trip_id ? (findConversationForTrip(lead.trip_id, "planner")?.summary ?? null) : null,
    nextAction: suggestNextAction(lead, listFollowUps(lead.id)),
    followUps: listFollowUps(lead.id),
  };
});

const PatchSchema = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  assignedTo: z.string().max(64).nullable().optional(),
  nextFollowUpAt: z.iso.datetime().nullable().optional(),
  lostReason: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().min(1).max(2000).optional(),
});

export const PATCH = route<{ id: string }>({}, async ({ req, actor, params }) => {
  const user = requirePermission(actor, "leads:write");
  const body = await parseBody(req, PatchSchema);
  if (body.assignedTo) {
    const assignee = getUser(body.assignedTo);
    if (!assignee || !["sales", "admin"].includes(assignee.role)) throw badRequest("Leads can only be assigned to sales staff");
  }
  try {
    return { lead: updateLead({ userId: user.id, label: user.name }, params.id, body) };
  } catch (e) {
    if (e instanceof LeadError) {
      if (e.code === "not_found") throw notFound(e.message);
      if (e.code === "duplicate") throw conflict(e.message);
      throw new ApiError(409, "invalid_transition", e.message);
    }
    throw e;
  }
});
