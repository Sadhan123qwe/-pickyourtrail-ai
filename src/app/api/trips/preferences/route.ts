import { route } from "@/lib/http";
import { startPlanning } from "@/lib/services/planner";

/** Starts a new planning session: creates a trip, its preference profile and the planner conversation. */
export const POST = route({}, ({ actor }) => {
  const result = startPlanning(actor);
  return Response.json(result, { status: 201 });
});
