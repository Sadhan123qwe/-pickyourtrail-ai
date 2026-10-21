"use client";

import Link from "next/link";
import { useState } from "react";
import { Download } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { formatMoney, titleCase } from "@/lib/client/format";
import { Card, CardHeader, DemoBadge, EmptyState, ErrorState, Field, Input, PageHeader, Segmented, Skeleton, StatCard, Tabs } from "@/components/ui";
import { HorizontalBars, TimeSeriesChart } from "@/components/charts";

interface Report {
  range: { from: string; to: string };
  leadConversion: { leads: number; won: number; lost: number; leadsWithHandoff: number; leadToBookingRequestPct: number; leadToWonPct: number };
  planningCompletion: { sessions: number; completed: number; completionPct: number };
  support: {
    tickets: number;
    resolved: number;
    resolutionPct: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionHours: number | null;
    byPriority: { priority: string; tickets: number; avg_first_min: number | null }[];
  };
  satisfaction: { avgCsat: number | null; responses: number };
  avgEstimatedTripValue: number | null;
  value: { estimatedTripValue: number; openPipelineEstimate: number; acceptedQuotesUnconfirmed: number; confirmedRevenue: number; providerConfirmedBookings: number };
  popularDestinations: { destination: string; trips: number }[];
  series: { date: string; trips: number; itineraries: number; leads: number; won: number; handoffs: number; tickets: number }[];
  data: { total: number; demo: number; live: number };
  previous: {
    leadToBookingRequestPct: number;
    leadToWonPct: number;
    completionPct: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionHours: number | null;
    avgCsat: number | null;
    avgEstimatedTripValue: number | null;
    leads: number;
  };
  aiUsage?: {
    monthToDateUsd: number;
    requests: number;
    byCategory: { category: string; provider: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number; avgLatencyMs: number }[];
    byOutcome: { outcome: string; requests: number }[];
  };
}

const diff = (a: number | null | undefined, b: number | null | undefined, digits = 1) => (a === null || a === undefined || b === null || b === undefined ? null : Math.round((a - b) * 10 ** digits) / 10 ** digits);

const DEFINITIONS: [string, string][] = [
  ["Lead → booking request", "Leads created in the period whose trip has a customer-confirmed booking request (handoff), divided by all leads created in the period."],
  ["Lead → won", "Leads created in the period that a salesperson marked as won, divided by all leads created in the period."],
  ["Planning completion", "AI planning sessions started in the period that reached a generated itinerary."],
  ["Avg estimated trip value", "Average itinerary estimate (activities, stays, transport) for trips started in the period. An estimate, not revenue."],
  ["First response (avg)", "Average time from ticket creation to the first human agent reply, for tickets created in the period."],
  ["Resolution time (avg)", "Average time from ticket creation to resolution, for resolved tickets created in the period."],
  ["Customer satisfaction", "Average of 1–5 ratings customers gave on resolved tickets. Shown only when ratings exist."],
  ["Confirmed revenue", "Sum of bookings with a provider confirmation reference. No booking provider is connected in this build, so this stays at zero."],
  ["Trend arrows", "Change versus the immediately preceding period of the same length (percentage points for rates)."],
];

function isoDay(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export function Analytics({ isAdmin }: { isAdmin: boolean }) {
  const [preset, setPreset] = useState<"7" | "30" | "90" | "custom">("30");
  const [from, setFrom] = useState(isoDay(-29));
  const [to, setTo] = useState(isoDay(0));
  const [view, setView] = useState<"chart" | "table">("chart");
  const range = preset === "custom" ? { from, to } : { from: isoDay(-(Number(preset) - 1)), to: isoDay(0) };
  const qs = new URLSearchParams(range);
  const { data, error, loading, reload } = useApi<Report>(`/api/analytics/reports?${qs}`);

  return (
    <>
      <PageHeader
        title="Analytics & reports"
        description="Computed from application records for the selected period."
        actions={
          <>
            {data && data.data.demo > 0 && <DemoBadge label="Includes seeded demo data" />}
            <a href={`/api/analytics/reports?${qs}&format=csv`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-muted">
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </a>
          </>
        }
      />
      <Card className="mb-5 flex flex-wrap items-end gap-3 p-3">
        <Segmented
          label="Date range"
          value={preset}
          onChange={setPreset}
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
            { value: "custom", label: "Custom" },
          ]}
        />
        <p className="ml-auto text-xs text-muted">Trends compare with the preceding period of equal length.</p>
        {preset === "custom" && (
          <div className="flex gap-2">
            <Field label="From" htmlFor="from">
              <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="to">
              <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        )}
      </Card>

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      ) : loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Lead → booking request" value={`${data.leadConversion.leadToBookingRequestPct}%`} delta={diff(data.leadConversion.leadToBookingRequestPct, data.previous.leadToBookingRequestPct)} hint={`${data.leadConversion.leadsWithHandoff} of ${data.leadConversion.leads} leads · prev. ${data.previous.leadToBookingRequestPct}%`} />
            <StatCard label="Lead → won" value={`${data.leadConversion.leadToWonPct}%`} delta={diff(data.leadConversion.leadToWonPct, data.previous.leadToWonPct)} hint={`${data.leadConversion.won} won · ${data.leadConversion.lost} lost · prev. ${data.previous.leadToWonPct}%`} tone="green" />
            <StatCard label="Planning completion" value={`${data.planningCompletion.completionPct}%`} delta={diff(data.planningCompletion.completionPct, data.previous.completionPct)} hint={`${data.planningCompletion.completed} of ${data.planningCompletion.sessions} sessions reached an itinerary`} tone="teal" />
            <StatCard label="Avg estimated trip value" value={data.avgEstimatedTripValue ? formatMoney(data.avgEstimatedTripValue) : "—"} hint={`Itinerary estimates · prev. ${data.previous.avgEstimatedTripValue ? formatMoney(data.previous.avgEstimatedTripValue) : "—"}`} tone="green" />
            <StatCard label="First response (avg)" value={data.support.avgFirstResponseMinutes !== null ? `${data.support.avgFirstResponseMinutes} min` : "—"} delta={diff(data.support.avgFirstResponseMinutes, data.previous.avgFirstResponseMinutes, 0)} invert hint={`${data.support.tickets} tickets in period`} tone="amber" />
            <StatCard label="Resolution time (avg)" value={data.support.avgResolutionHours !== null ? `${data.support.avgResolutionHours} h` : "—"} delta={diff(data.support.avgResolutionHours, data.previous.avgResolutionHours)} invert hint={`${data.support.resolutionPct}% resolved`} tone="amber" />
            <StatCard label="Customer satisfaction" value={data.satisfaction.avgCsat !== null ? `${data.satisfaction.avgCsat} / 5` : "—"} delta={diff(data.satisfaction.avgCsat, data.previous.avgCsat)} hint={data.satisfaction.responses ? `${data.satisfaction.responses} ratings` : "No ratings in this period"} tone="green" />
            <StatCard label="Records in period" value={data.series.reduce((s, d) => s + d.trips + d.leads + d.tickets, 0)} hint={`${data.data.live} live · ${data.data.demo} demo records overall`} />
          </div>

          <Card>
            <CardHeader title="Value: estimates vs confirmed revenue" description="Estimates come from AI itineraries and customer budgets. Only provider-confirmed bookings count as revenue." />
            <div className="grid divide-y divide-border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
              {[
                ["Estimated trip value", data.value.estimatedTripValue, "Sum of itinerary estimates for trips started in period", "text-foreground"],
                ["Open pipeline (estimate)", data.value.openPipelineEstimate, "Estimated value of open sales leads", "text-foreground"],
                ["Accepted quotes — not confirmed", data.value.acceptedQuotesUnconfirmed, "Customer accepted a quote; supplier confirmation still required", "text-warning"],
                ["Confirmed revenue", data.value.confirmedRevenue, `${data.value.providerConfirmedBookings} provider-confirmed bookings — no booking provider is connected`, "text-accent"],
              ].map(([label, v, hint, tone]) => (
                <div key={label as string} className="p-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{formatMoney(v as number)}</p>
                  <p className="mt-1 text-xs text-muted">{hint}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Pipeline over time"
              description="Daily counts"
              action={
                <Tabs
                  value={view}
                  onChange={setView}
                  tabs={[
                    { value: "chart", label: "Chart" },
                    { value: "table", label: "Table" },
                  ]}
                />
              }
            />
            <div className="p-5">
              {view === "chart" ? (
                <TimeSeriesChart
                  height={300}
                  data={data.series}
                  series={[
                    { key: "trips", label: "Planning sessions" },
                    { key: "itineraries", label: "Itineraries" },
                    { key: "leads", label: "Leads" },
                    { key: "won", label: "Won" },
                  ]}
                />
              ) : (
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="border-b border-border text-left text-xs text-muted">
                        {["Date", "Sessions", "Itineraries", "Leads", "Won", "Booking requests", "Tickets"].map((h) => (
                          <th key={h} className="px-3 py-2 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.series.map((d) => (
                        <tr key={d.date} className="border-b border-border/60 tabular-nums">
                          <td className="px-3 py-1.5">{d.date}</td>
                          <td className="px-3 py-1.5">{d.trips}</td>
                          <td className="px-3 py-1.5">{d.itineraries}</td>
                          <td className="px-3 py-1.5">{d.leads}</td>
                          <td className="px-3 py-1.5">{d.won}</td>
                          <td className="px-3 py-1.5">{d.handoffs}</td>
                          <td className="px-3 py-1.5">{d.tickets}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Popular destinations" description="Trips started in period" />
              <div className="p-5">
                {data.popularDestinations.length ? <HorizontalBars data={data.popularDestinations} labelKey="destination" valueKey="trips" valueLabel="Trips" /> : <EmptyState title="No trips in this period" />}
              </div>
            </Card>
            <Card>
              <CardHeader title="Support by priority" description="Tickets created in period" />
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-5 py-2 font-medium">Priority</th>
                    <th className="px-5 py-2 font-medium">Tickets</th>
                    <th className="px-5 py-2 font-medium">Avg first response</th>
                  </tr>
                </thead>
                <tbody>
                  {data.support.byPriority.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-5 py-6 text-center text-muted">
                        No tickets in this period
                      </td>
                    </tr>
                  )}
                  {data.support.byPriority.map((p) => (
                    <tr key={p.priority} className="border-b border-border/60">
                      <td className="px-5 py-2">{titleCase(p.priority)}</td>
                      <td className="px-5 py-2 tabular-nums">{p.tickets}</td>
                      <td className="px-5 py-2 tabular-nums">{p.avg_first_min !== null ? `${p.avg_first_min} min` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          {isAdmin && data.aiUsage && <AiUsagePanel usage={data.aiUsage} />}

          <Card>
            <CardHeader title="Metric definitions" description="How each number on this page is calculated. Nothing is projected or fabricated." />
            <dl className="grid gap-x-6 gap-y-3 p-4 text-[13px] md:grid-cols-2">
              {DEFINITIONS.map(([k, v]) => (
                <div key={k}>
                  <dt className="font-medium">{k}</dt>
                  <dd className="text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function AiUsagePanel({ usage }: { usage: NonNullable<Report["aiUsage"]> }) {
  return (
    <Card>
      <CardHeader title="AI usage & cost controls" description="Requests, tokens and estimated spend in this period. No prompts or personal data are logged." />
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_320px]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                {["Category", "Provider", "Requests", "Input tokens", "Output tokens", "Est. cost (USD)", "Avg latency"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usage.byCategory.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
                    No AI requests in this period
                  </td>
                </tr>
              )}
              {usage.byCategory.map((r) => (
                <tr key={`${r.category}-${r.provider}`} className="border-b border-border/60 tabular-nums">
                  <td className="px-3 py-2">{titleCase(r.category)}</td>
                  <td className="px-3 py-2">{r.provider === "mock" ? "Rules (no API call)" : r.provider}</td>
                  <td className="px-3 py-2">{r.requests}</td>
                  <td className="px-3 py-2">{r.inputTokens ?? 0}</td>
                  <td className="px-3 py-2">{r.outputTokens ?? 0}</td>
                  <td className="px-3 py-2">${(r.costUsd ?? 0).toFixed(4)}</td>
                  <td className="px-3 py-2">{r.avgLatencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            Outcomes: {usage.byOutcome.map((o) => `${titleCase(o.outcome)} ${o.requests}`).join(" · ") || "none"}. Costs are estimates from list prices.
          </p>
        </div>
        <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
          <h3 className="font-semibold">Guard rails</h3>
          <p className="text-muted">Month-to-date estimated spend: ${usage.monthToDateUsd.toFixed(4)}.</p>
          <p className="text-muted">Budget, per-user limits and the live-AI kill switch are managed in Settings.</p>
          <Link href="/admin/settings" className="inline-block font-medium text-primary hover:underline">
            Open settings
          </Link>
        </div>
      </div>
    </Card>
  );
}
