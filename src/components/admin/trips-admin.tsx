"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { MessageSquareText, Sparkles, X } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { formatDate, formatDateTime, formatMoney, formatMonth, relativeTime, titleCase, useDebounced } from "@/lib/client/format";
import type { TripDetail, TripRow } from "@/lib/client/types";
import { Alert, Badge, Card, CardHeader, DRAWER_CLASS, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, SkeletonRows, Tabs, Timeline, cn } from "@/components/ui";
import { BookingLifecycle, LeadStageBadge, OpsStatusBadge, ProviderStatusBadge, TripStatusBadge } from "@/components/status";
import { BudgetCard } from "@/components/itinerary/budget-card";

type TripItem = TripRow & {
  customer_name: string | null;
  lead_name: string | null;
  handoff_status: string | null;
  budget_status: string | null;
  itinerary_id: string | null;
  is_demo: number;
};

type EmployeeTripDetail = TripDetail & {
  conversation?: { id: string; summary: string | null; messageCount: number; recent: { role: string; content: string; createdAt: string }[] } | null;
};

const FLAGS = [
  { value: "", label: "All trips" },
  { value: "awaiting_review", label: "Awaiting customer review" },
  { value: "over_budget", label: "Over budget" },
  { value: "no_itinerary", label: "Still planning" },
] as const;

export function TripsAdmin() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("trip");
  const [flag, setFlag] = useState<string>(params.get("flag") ?? "");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const qs = new URLSearchParams({ scope: "all", page: String(page), pageSize: "15", ...(status && { status }), ...(flag && { flag }), ...(dq && { q: dq }) });
  const list = useApi<{ items: TripItem[]; total: number; page: number; pageSize: number }>(`/api/trips?${qs}`);
  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("trip", id);
    else next.delete("trip");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <>
      <PageHeader title="Trips & itineraries" description="Every trip planned by customers — preferences, AI-generated itineraries, estimated budgets and where each trip stands." />
      <Tabs className="mb-4" value={flag} onChange={(v) => (setFlag(v), setPage(1))} tabs={FLAGS.map((f) => ({ value: f.value, label: f.label }))} />
      <div className={cn("grid gap-6", selected && "2xl:grid-cols-[1fr_520px]")}>
        <Card className="min-w-0">
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2">
            <Input type="search" aria-label="Search trips" placeholder="Search title, destination, customer" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
            <Select aria-label="Trip status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
              <option value="">Any status</option>
              {["planning", "itinerary_ready", "saved", "handoff_requested", "booked", "completed", "cancelled"].map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </div>
          {list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : list.loading && !list.data ? (
            <SkeletonRows rows={8} />
          ) : !list.data?.items.length ? (
            <EmptyState title="No trips match" description="Try another filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Trip</th>
                    <th className="px-4 py-2 font-medium">Customer</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Estimate</th>
                    <th className="px-4 py-2 font-medium">Budget</th>
                    <th className="px-4 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((t) => (
                    <tr key={t.id} onClick={() => select(t.id)} className={cn("cursor-pointer border-b border-border/60 hover:bg-surface-muted", selected === t.id && "bg-primary-soft/60")}>
                      <td className="px-4 py-2.5">
                        <button className="text-left font-medium hover:text-primary">{t.title}</button>
                        <p className="text-xs text-muted">
                          {t.travellers ? `${t.travellers} pax · ` : ""}
                          {t.duration_days ? `${t.duration_days} days · ` : ""}
                          {t.travel_month ? formatMonth(t.travel_month) : "no dates"}
                          {t.is_demo ? " · demo" : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">{t.customer_name ?? t.lead_name ?? <span className="text-muted">Guest</span>}</td>
                      <td className="px-4 py-2.5">
                        <TripStatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{t.estimated_total ? formatMoney(t.estimated_total) : "—"}</td>
                      <td className="px-4 py-2.5">
                        {t.budget_status === "over" ? <Badge tone="red">Over budget</Badge> : t.budget_status === "near" ? <Badge tone="amber">Near</Badge> : t.budget_status === "under" ? <Badge tone="green">Within</Badge> : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted">{relativeTime(t.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
        </Card>
        {selected && <TripDrawer id={selected} onClose={() => select(null)} />}
      </div>
    </>
  );
}

function TripDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading, reload } = useApi<EmployeeTripDetail>(`/api/trips/${id}`);
  const [tab, setTab] = useState<"itinerary" | "conversation" | "audit">("itinerary");
  const lead = data?.lead as { id: string; name: string; stage: string } | null | undefined;
  return (
    <Card className={DRAWER_CLASS}>
      <CardHeader
        title={data?.trip.title ?? "Trip"}
        description={data ? `Updated ${formatDateTime(data.trip.updated_at)}` : undefined}
        action={
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-muted" aria-label="Close trip">
            <X className="h-5 w-5" />
          </button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} compact />
      ) : loading && !data ? (
        <SkeletonRows rows={8} />
      ) : data ? (
        <div className="space-y-4 p-5 text-sm">
          <div className="flex flex-wrap gap-2">
            <TripStatusBadge status={data.trip.status} />
            {lead && <LeadStageBadge stage={lead.stage} />}
            {data.handoff && <OpsStatusBadge status={data.handoff.ops_status} />}
            {data.handoff && <ProviderStatusBadge status={data.handoff.provider_status} reference={data.handoff.provider_reference} />}
          </div>
          <div className="rounded-lg border border-border bg-surface-muted/50 p-3">
            <BookingLifecycle hasItinerary={!!data.itinerary} opsStatus={data.handoff?.ops_status} providerStatus={data.handoff?.provider_status} />
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {lead && (
              <Link href={`/admin/leads?lead=${lead.id}`} className="text-primary hover:underline">
                Lead: {lead.name}
              </Link>
            )}
            {data.handoff && (
              <Link href={`/admin/bookings?handoff=${data.handoff.id}`} className="text-primary hover:underline">
                Booking request
              </Link>
            )}
            {lead && (
              <Link href={`/admin/copilot?leadId=${lead.id}&label=${encodeURIComponent(`Lead: ${lead.name}`)}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Ask AI about this customer
              </Link>
            )}
          </div>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Structured preferences</h3>
            <p className="text-slate-700">{data.summary || "No preferences captured yet."}</p>
          </section>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "itinerary", label: data.itinerary ? `Itinerary v${data.itinerary.version}` : "Itinerary" },
              { value: "conversation", label: "Conversation", count: data.conversation?.messageCount },
              { value: "audit", label: "Audit", count: data.audit?.length },
            ]}
          />
          {tab === "itinerary" &&
            (data.itinerary ? (
              <div className="space-y-4">
                <p className="text-xs text-muted">
                  Generated by {data.itinerary.generatedBy} · read-only for staff (customers edit their own plan).
                </p>
                <ol className="space-y-2">
                  {data.itinerary.days.map((d) => (
                    <li key={d.id} className="rounded-md border border-border p-3">
                      <p className="font-medium">
                        Day {d.dayNumber}: {d.title}
                        {d.date && <span className="ml-1 text-xs font-normal text-muted">({formatDate(d.date)})</span>}
                      </p>
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                        {d.items
                          .filter((i) => i.kind === "activity")
                          .map((i) => (
                            <li key={i.id} className="flex justify-between gap-2">
                              <span>{i.title}</span>
                              <span className="tabular-nums text-muted">{i.estCost ? formatMoney(i.estCost) : "Free"}</span>
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
                </ol>
                <BudgetCard budget={data.itinerary.budget} compact />
              </div>
            ) : (
              <EmptyState title="No itinerary yet" description="The customer is still answering the planner's questions." />
            ))}
          {tab === "conversation" &&
            (data.conversation ? (
              <div className="space-y-3">
                {data.conversation.summary && <Alert tone="blue" title="Conversation summary (structured)">{data.conversation.summary}</Alert>}
                <ol className="space-y-2">
                  {data.conversation.recent.map((m, i) => (
                    <li key={i} className={cn("rounded-md p-2.5 text-xs", m.role === "user" ? "bg-primary-soft" : "bg-surface-muted")}>
                      <p className="mb-0.5 flex items-center gap-1 font-medium text-muted">
                        <MessageSquareText className="h-3 w-3" aria-hidden /> {m.role === "user" ? "Customer" : "AI planner"} · {formatDateTime(m.createdAt)}
                      </p>
                      <p className="whitespace-pre-line text-slate-800">{m.content.replace(/\*\*/g, "")}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <EmptyState title="No planning conversation" />
            ))}
          {tab === "audit" &&
            (data.audit?.length ? (
              <Timeline items={data.audit.map((a) => ({ id: a.id, title: `${titleCase(a.entity_type.replace(/_/g, " "))} ${a.action.replace(/[_:]/g, " ")}`, meta: `${a.actor_label} · ${formatDateTime(a.created_at)}` }))} />
            ) : (
              <EmptyState title="No audit events" description={data.audit ? "Nothing recorded yet." : "Audit history is visible to operations and admins."} />
            ))}
        </div>
      ) : null}
    </Card>
  );
}
