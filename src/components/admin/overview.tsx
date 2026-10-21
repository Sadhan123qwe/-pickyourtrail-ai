"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, AlarmClock, Briefcase, LifeBuoy, Map, Percent, PlaneTakeoff, ShieldAlert, Sparkles, TriangleAlert } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { formatDateTime, relativeTime } from "@/lib/client/format";
import { Card, CardHeader, DemoBadge, EmptyState, ErrorState, PageHeader, Segmented, Skeleton, StatCard, cn } from "@/components/ui";
import { LeadStageBadge, PriorityBadge, TicketStatusBadge } from "@/components/status";
import { Funnel, HorizontalBars, TimeSeriesChart } from "@/components/charts";

interface Overview {
  days: number;
  conversion: { leads: number; withBookingRequest: number; pct: number | null; previousPct: number | null; previousLeads: number };
  activity: { id: string; kind: string; title: string; actor: string; at: string; href: string | null }[];
  exceptions: { type: string; severity: "high" | "medium"; title: string; detail: string; entityId: string | null; at: string }[];
  kpis: {
    newLeads: number;
    newLeadsPrev: number;
    activeTripPlans: number;
    bookingHandoffsOpen: number;
    bookingHandoffsPending: number;
    openTickets: number;
    urgentTickets: number;
    followUpsDue: number;
    followUpsOverdue: number;
  };
  funnel: { stage: string; value: number }[];
  popularDestinations: { destination: string; trips: number }[];
  series: { date: string; trips: number; leads: number; handoffs: number; tickets: number }[];
  recentLeads: { id: string; name: string; destination: string | null; stage: string; score: number; created_at: string; is_demo: number }[];
  urgentQueue: { id: string; ref: string; subject: string; priority: string; status: string; created_at: string }[];
  dueFollowUps: { id: string; lead_id: string; lead_name: string; channel: string; due_at: string; note: string | null }[];
  data: { total: number; demo: number; live: number };
}

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const EXCEPTION_HREF: Record<string, (id: string) => string> = {
  urgent_ticket: (id) => `/admin/support?ticket=${id}`,
  overdue_follow_up: (id) => `/admin/leads?lead=${id}`,
  failed_handoff: (id) => `/admin/bookings?handoff=${id}`,
  stale_handoff: (id) => `/admin/bookings?handoff=${id}`,
};

export function AdminOverview({ name }: { name: string }) {
  const [range, setRange] = useState("30");
  const { data, error, loading, reload } = useApi<Overview>(`/api/dashboard/overview?days=${range}`);
  const delta = data ? data.kpis.newLeads - data.kpis.newLeadsPrev : 0;
  const convDelta = data && data.conversion.pct !== null && data.conversion.previousPct !== null ? Math.round((data.conversion.pct - data.conversion.previousPct) * 10) / 10 : null;
  return (
    <>
      <PageHeader
        title="Business overview"
        description={`Welcome back, ${name.split(" ")[0]}. Every number here is computed from stored application records — none are projections.`}
        actions={
          <>
            {data && data.data.demo > 0 && <DemoBadge label={`${data.data.demo} demo · ${data.data.live} live records`} />}
            <Segmented label="Date range" options={RANGES} value={range} onChange={setRange} />
            <Link href="/admin/command-center" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-nav px-3 text-[13px] font-medium text-white hover:bg-nav-deep">
              <Sparkles className="h-4 w-4 text-ai" aria-hidden /> AI Command Center
            </Link>
          </>
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className={cn("space-y-5 transition-opacity", loading && "opacity-60")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <StatCard label="New leads (7 days)" value={data.kpis.newLeads} delta={delta} hint="vs previous 7 days" icon={<Briefcase className="h-4 w-4" />} href="/admin/leads" />
            <StatCard
              label={`Lead → booking request (${range}d)`}
              value={data.conversion.pct === null ? "—" : `${data.conversion.pct}%`}
              delta={convDelta}
              hint={data.conversion.leads ? `${data.conversion.withBookingRequest} of ${data.conversion.leads} leads · vs previous ${range}d` : "No leads in this period"}
              icon={<Percent className="h-4 w-4" />}
              tone="teal"
              href="/admin/analytics"
            />
            <StatCard label="Active trip plans" value={data.kpis.activeTripPlans} hint="Engaged in the last 30 days" icon={<Map className="h-4 w-4" />} tone="green" href="/admin/trips" />
            <StatCard label="Booking requests open" value={data.kpis.bookingHandoffsOpen} hint={`${data.kpis.bookingHandoffsPending} awaiting review`} icon={<PlaneTakeoff className="h-4 w-4" />} href="/admin/bookings" />
            <StatCard label="Open support tickets" value={data.kpis.openTickets} hint={`${data.kpis.urgentTickets} urgent`} icon={<LifeBuoy className="h-4 w-4" />} tone={data.kpis.urgentTickets ? "red" : "blue"} href="/admin/support" />
            <StatCard label="Follow-ups due today" value={data.kpis.followUpsDue} hint={`${data.kpis.followUpsOverdue} overdue`} icon={<AlarmClock className="h-4 w-4" />} tone={data.kpis.followUpsOverdue ? "amber" : "green"} href="/admin/leads?sort=follow_up_asc" />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Card className="min-w-0">
              <CardHeader title="Business activity" description={`Daily counts, last ${range} days`} />
              <div className="p-4">
                <TimeSeriesChart
                  data={data.series}
                  series={[
                    { key: "trips", label: "Planning sessions" },
                    { key: "leads", label: "New leads" },
                    { key: "handoffs", label: "Booking requests" },
                    { key: "tickets", label: "Support tickets" },
                  ]}
                />
              </div>
            </Card>
            <Card className="ai-edge min-w-0">
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-accent" aria-hidden /> Detected exceptions
                  </span>
                }
                description="Rule-based checks on today's records (overdue follow-ups, urgent cases, stuck booking requests, AI failures)"
                action={
                  <Link href="/admin/command-center" className="text-[13px] text-primary hover:underline">
                    Review
                  </Link>
                }
              />
              {data.exceptions.length ? (
                <ul className="divide-y divide-border">
                  {data.exceptions.map((e, i) => {
                    const href = e.entityId ? EXCEPTION_HREF[e.type]?.(e.entityId) : undefined;
                    const body = (
                      <>
                        <TriangleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", e.severity === "high" ? "text-danger" : "text-warning")} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{e.title}</span>
                          <span className="block truncate text-xs text-muted">{e.detail}</span>
                        </span>
                        <span className="whitespace-nowrap text-xs text-muted">{relativeTime(e.at)}</span>
                      </>
                    );
                    return (
                      <li key={i}>
                        {href ? (
                          <Link href={href} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-muted">
                            {body}
                          </Link>
                        ) : (
                          <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState title="No exceptions detected today" description="Overdue follow-ups, urgent cases and failed requests appear here." />
              )}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            <Card className="min-w-0">
              <CardHeader title="Conversion funnel" description={`Trips started in the last ${range} days`} />
              <div className="p-4">
                <Funnel steps={data.funnel} />
              </div>
            </Card>
            <Card className="min-w-0">
              <CardHeader title="Popular destinations" description={`Trips started, last ${range} days`} />
              <div className="p-4">
                {data.popularDestinations.length ? <HorizontalBars data={data.popularDestinations} labelKey="destination" valueKey="trips" valueLabel="Trips" /> : <EmptyState title="No trips in this period" />}
              </div>
            </Card>
            <Card className="min-w-0 lg:col-span-2 xl:col-span-1">
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" aria-hidden /> Recent activity
                  </span>
                }
                description="From the audit log"
              />
              {data.activity.length ? (
                <ol className="max-h-[340px] divide-y divide-border overflow-y-auto">
                  {data.activity.map((a) => {
                    const body = (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{a.title}</span>
                          <span className="block truncate text-xs text-muted">{a.actor}</span>
                        </span>
                        <span className="whitespace-nowrap text-xs text-muted">{relativeTime(a.at)}</span>
                      </>
                    );
                    return (
                      <li key={a.id}>
                        {a.href ? (
                          <Link href={a.href} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-muted">
                            {body}
                          </Link>
                        ) : (
                          <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <EmptyState title="No recorded activity yet" />
              )}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader
                title="Priority support queue"
                action={
                  <Link href="/admin/support" className="text-[13px] text-primary hover:underline">
                    Open queue
                  </Link>
                }
              />
              {data.urgentQueue.length ? (
                <ul className="divide-y divide-border">
                  {data.urgentQueue.map((t) => (
                    <li key={t.id}>
                      <Link href={`/admin/support?ticket=${t.id}`} className="block px-4 py-2.5 hover:bg-surface-muted">
                        <p className="flex items-center gap-2 text-[13px] font-medium">
                          {t.priority === "urgent" && <TriangleAlert className="h-4 w-4 text-tomato" aria-hidden />}
                          {t.subject}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          {t.ref} <PriorityBadge priority={t.priority} /> <TicketStatusBadge status={t.status} /> {relativeTime(t.created_at)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Queue is clear" />
              )}
            </Card>
            <Card className="min-w-0">
              <CardHeader
                title="Follow-ups due"
                action={
                  <Link href="/admin/leads?sort=follow_up_asc" className="text-[13px] text-primary hover:underline">
                    All leads
                  </Link>
                }
              />
              {data.dueFollowUps.length ? (
                <ul className="divide-y divide-border">
                  {data.dueFollowUps.map((f) => (
                    <li key={f.id}>
                      <Link href={`/admin/leads?lead=${f.lead_id}`} className="block px-4 py-2.5 hover:bg-surface-muted">
                        <p className="text-[13px] font-medium">{f.lead_name}</p>
                        <p className="text-xs text-muted">
                          {f.channel} · due {formatDateTime(f.due_at)} {new Date(f.due_at) < new Date() && <span className="text-danger">(overdue)</span>}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nothing due today" />
              )}
            </Card>
          </div>

          <Card className="min-w-0">
            <CardHeader
              title="Newest leads"
              action={
                <Link href="/admin/leads" className="text-[13px] text-primary hover:underline">
                  Open CRM
                </Link>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/50 text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Lead</th>
                    <th className="px-4 py-2 font-medium">Destination</th>
                    <th className="px-4 py-2 font-medium">Stage</th>
                    <th className="px-4 py-2 font-medium">Score</th>
                    <th className="px-4 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentLeads.map((l) => (
                    <tr key={l.id} className="border-b border-border/60 last:border-0 hover:bg-surface-muted/60">
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/leads?lead=${l.id}`} className="font-medium hover:text-primary">
                          {l.name}
                        </Link>
                        {l.is_demo ? <span className="ml-2 text-[10px] uppercase text-warning">demo</span> : <span className="ml-2 text-[10px] uppercase text-accent">live</span>}
                      </td>
                      <td className="px-4 py-2.5">{l.destination ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <LeadStageBadge stage={l.stage} />
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{l.score}</td>
                      <td className="px-4 py-2.5 text-muted">{relativeTime(l.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
