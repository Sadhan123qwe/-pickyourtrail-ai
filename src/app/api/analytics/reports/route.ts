import { z } from "zod";
import { badRequest, parseQuery, requirePermission, route } from "@/lib/http";
import { analyticsReport, defaultRange, headlineKpis, seriesToCsv } from "@/lib/repos/metrics";
import { usageSummary } from "@/lib/ai/usage";
import { can } from "@/lib/auth/permissions";

const QuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

export const GET = route({}, ({ req, actor }) => {
  requirePermission(actor, "analytics:read");
  const q = parseQuery(req, QuerySchema);
  const range = q.from && q.to ? { from: `${q.from}T00:00:00.000Z`, to: new Date(Date.parse(`${q.to}T00:00:00.000Z`) + 86_400_000).toISOString() } : defaultRange(30);
  if (Date.parse(range.from) >= Date.parse(range.to)) throw badRequest("'from' must be before 'to'");
  if (Date.parse(range.to) - Date.parse(range.from) > 366 * 86_400_000) throw badRequest("Date range can be at most one year");
  const report = analyticsReport(range);
  if (q.format === "csv") {
    return new Response(seriesToCsv(report.series), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pickyourtrail-report-${range.from.slice(0, 10)}-to-${q.to ?? range.to.slice(0, 10)}.csv"`,
      },
    });
  }
  // Trend comparison: the same-length period immediately before.
  const span = Date.parse(range.to) - Date.parse(range.from);
  const prev = headlineKpis({ from: new Date(Date.parse(range.from) - span).toISOString(), to: range.from });
  const previous = {
    leadToBookingRequestPct: prev.leadConversion.leadToBookingRequestPct,
    leadToWonPct: prev.leadConversion.leadToWonPct,
    completionPct: prev.planningCompletion.completionPct,
    avgFirstResponseMinutes: prev.support.avgFirstResponseMinutes,
    avgResolutionHours: prev.support.avgResolutionHours,
    avgCsat: prev.satisfaction.avgCsat,
    avgEstimatedTripValue: prev.avgEstimatedTripValue,
    leads: prev.leadConversion.leads,
  };
  return { ...report, previous, aiUsage: can(actor.role, "settings:manage") ? usageSummary(range.from) : undefined };
});
