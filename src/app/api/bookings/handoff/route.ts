import { z } from "zod";
import { parseBody, route } from "@/lib/http";
import { requestBookingHandoff } from "@/lib/services/trips";

const HandoffSchema = z.object({
  tripId: z.string().min(1).max(64),
  contactName: z.string().trim().min(2, "Please enter your name").max(80),
  contactEmail: z.email("Please enter a valid email").max(120),
  contactPhone: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  /** Explicit customer confirmation is required for this consequential action. */
  confirm: z.literal(true, { error: "Please confirm that you want to send this booking request" }),
  idempotencyKey: z.string().min(8).max(80),
});

/**
 * Hands a trip to the travel-expert/booking queue. This never reports a
 * confirmed booking unless a real provider returns a confirmation reference.
 */
export const POST = route({}, async ({ req, actor }) => {
  const body = await parseBody(req, HandoffSchema);
  const result = await requestBookingHandoff(actor, body);
  return Response.json(result, { status: result.duplicate ? 200 : 201 });
});
