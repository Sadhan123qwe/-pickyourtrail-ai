import { paginate, requirePermission, route } from "@/lib/http";
import { handoffStatusCounts, listHandoffs } from "@/lib/repos/handoffs";
import { getBookingProvider } from "@/lib/providers/booking";

export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "trips:read_all");
  const sp = req.nextUrl.searchParams;
  const { page, pageSize, offset } = paginate(sp);
  const { items, total } = listHandoffs({ status: sp.get("status") ?? undefined, q: sp.get("q")?.slice(0, 80) ?? undefined, limit: pageSize, offset });
  const provider = getBookingProvider();
  return { items, total, page, pageSize, counts: handoffStatusCounts(), provider: { name: provider.name, live: provider.live } };
});
