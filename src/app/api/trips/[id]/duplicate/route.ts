import { route } from "@/lib/http";
import { duplicateTripAsOwner } from "@/lib/services/trips";

export const POST = route<{ id: string }>({}, ({ actor, params }) => {
  return Response.json({ trip: duplicateTripAsOwner(actor, params.id) }, { status: 201 });
});
