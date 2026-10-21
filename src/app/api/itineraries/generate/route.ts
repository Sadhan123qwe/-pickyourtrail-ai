import { z } from "zod";
import { parseBody, route } from "@/lib/http";
import { generateItinerary } from "@/lib/services/itinerary";

const GenerateSchema = z.object({
  tripId: z.string().min(1).max(64),
  /** Regenerate even if the inputs haven't changed. */
  force: z.boolean().optional(),
});

export const POST = route({ rateLimit: "ai" }, async ({ req, actor }) => {
  const body = await parseBody(req, GenerateSchema);
  const result = await generateItinerary(actor, body.tripId, { force: body.force });
  return Response.json(result, { status: result.reused ? 200 : 201 });
});
