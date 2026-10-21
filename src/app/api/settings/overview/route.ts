import { requirePermission, route } from "@/lib/http";
import { PERMISSIONS, ROLES, ROLE_LABELS, can } from "@/lib/auth/permissions";
import { getAiConfig } from "@/lib/config";
import { getAiSettings, monthToDateSpendUsd } from "@/lib/ai/usage";
import { getBookingProvider } from "@/lib/providers/booking";
import { demoShare } from "@/lib/repos/metrics";

/** Read-only workspace configuration for every employee. Never includes secrets. */
export const GET = route({}, ({ actor }) => {
  requirePermission(actor, "dashboard:read");
  const ai = getAiConfig();
  const live = ai.mode === "live";
  const booking = getBookingProvider();
  return {
    canManage: can(actor.role, "settings:manage"),
    ai: {
      mode: ai.mode,
      reason: ai.reason,
      routineModel: ai.models.routine,
      advancedModel: ai.models.advanced,
      realtimeModel: ai.models.realtime,
      limits: ai.limits,
      apiKeyConfigured: !!ai.apiKey,
    },
    guardRails: { ...getAiSettings(), monthToDateUsd: monthToDateSpendUsd() },
    integrations: [
      { name: "OpenAI (text: planner, itinerary, support, copilot)", status: live ? "live" : "mock", detail: live ? `Server-side key configured · ${ai.models.routine}` : ai.reason },
      { name: "OpenAI Realtime (robot voice)", status: live ? "live" : "unavailable", detail: live ? `WebRTC; short-lived client secrets per session (model ${ai.models.realtime})` : "Requires live AI; the browser-voice demo is used instead" },
      { name: "Browser voice (demo fallback)", status: "demo", detail: "Web Speech API recognition + speech synthesis in the customer's browser; no AI audio, labelled in the UI" },
      { name: "Browser dictation", status: "live", detail: "Web Speech API in supported browsers" },
      { name: "Database", status: "live", detail: "Local SQLite (node:sqlite). Supabase/Postgres adapter not implemented." },
      { name: "Booking provider", status: booking.live ? "live" : "demo", detail: `${booking.name} — never confirms bookings` },
      { name: "Flights, hotels & activities pricing", status: "demo", detail: "Sample catalog; all prices are estimates" },
      { name: "Email / WhatsApp messaging", status: "not connected", detail: "Follow-ups are recorded as tasks; nothing is sent" },
      { name: "Payments", status: "not connected", detail: "No payment integration" },
    ],
    roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r], permissions: PERMISSIONS.filter((p) => can(r, p)) })),
    permissions: PERMISSIONS,
    data: demoShare(),
  };
});
