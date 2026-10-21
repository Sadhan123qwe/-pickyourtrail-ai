import { paginate, requirePermission, route } from "@/lib/http";
import { listAllTrips, listTripsForOwner } from "@/lib/repos/trips";

/**
 * GET /api/trips            → the caller's own trips (account or anonymous session)
 * GET /api/trips?scope=all  → all trips (employees with trips:read_all)
 */
export const GET = route({}, ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  if (sp.get("scope") === "all") {
    requirePermission(actor, "trips:read_all");
    const { page, pageSize, offset } = paginate(sp);
    const { items, total } = listAllTrips({ status: sp.get("status") ?? undefined, q: sp.get("q")?.slice(0, 80) ?? undefined, flag: sp.get("flag") ?? undefined, limit: pageSize, offset });
    return { items, total, page, pageSize };
  }
  const items = listTripsForOwner(actor);
  return { items, total: items.length, page: 1, pageSize: items.length };
});
