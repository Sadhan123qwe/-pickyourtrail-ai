"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { formatMoney, relativeTime, useDebounced } from "@/lib/client/format";
import { Badge, Card, CardHeader, DRAWER_CLASS, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, SkeletonRows, cn } from "@/components/ui";
import { LeadStageBadge, PriorityBadge, TicketStatusBadge, TripStatusBadge } from "@/components/status";

interface Customer {
  key: string;
  kind: "registered" | "guest";
  name: string;
  email: string | null;
  phone: string | null;
  trips: number;
  open_leads: number;
  open_tickets: number;
  pipeline_value: number | null;
  last_activity_at: string;
  is_demo: number;
}
interface CustomerDetail {
  customer: Customer;
  trips: { id: string; title: string; status: string; estimated_total: number | null; updated_at: string }[];
  leads: { id: string; destination: string | null; stage: string; score: number; estimated_value: number | null; assignee_name: string | null }[] | null;
  tickets: { id: string; ref: string; subject: string; status: string; priority: string; updated_at: string }[] | null;
  conversations: { id: string; kind: string; summary: string | null; trip_id: string | null; updated_at: string; messages: number }[];
}

export function Customers() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("customer");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const qs = new URLSearchParams({ page: String(page), pageSize: "20", ...(dq && { q: dq }), ...(kind && { kind }) });
  const list = useApi<{ items: Customer[]; total: number; page: number; pageSize: number }>(`/api/customers?${qs}`);
  const select = (key: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (key) next.set("customer", key);
    else next.delete("customer");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  return (
    <>
      <PageHeader title="Customers" description="One view of every customer across planning, sales and support — registered accounts and guests who planned without signing in." />
      <div className={cn("grid gap-6", selected && "2xl:grid-cols-[1fr_480px]")}>
        <Card className="min-w-0">
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-[1fr_200px]">
            <Input type="search" aria-label="Search customers" placeholder="Search name or email" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
            <Select aria-label="Customer type" value={kind} onChange={(e) => (setKind(e.target.value), setPage(1))}>
              <option value="">All customers</option>
              <option value="registered">Registered accounts</option>
              <option value="guest">Guests (anonymous planning)</option>
            </Select>
          </div>
          {list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : list.loading && !list.data ? (
            <SkeletonRows rows={8} />
          ) : !list.data?.items.length ? (
            <EmptyState title="No customers match" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Customer</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Trips</th>
                    <th className="px-4 py-2 font-medium">Open leads</th>
                    <th className="px-4 py-2 font-medium">Open tickets</th>
                    <th className="px-4 py-2 font-medium">Pipeline (est.)</th>
                    <th className="px-4 py-2 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((c) => (
                    <tr key={c.key} onClick={() => select(c.key)} className={cn("cursor-pointer border-b border-border/60 hover:bg-surface-muted", selected === c.key && "bg-primary-soft/60")}>
                      <td className="px-4 py-2.5">
                        <button className="text-left font-medium hover:text-primary">{c.name}</button>
                        <p className="text-xs text-muted">
                          {c.email ?? "No email"}
                          {c.is_demo ? " · demo" : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">{c.kind === "registered" ? <Badge tone="blue">Registered</Badge> : <Badge>Guest</Badge>}</td>
                      <td className="px-4 py-2.5 tabular-nums">{c.trips}</td>
                      <td className="px-4 py-2.5 tabular-nums">{c.open_leads}</td>
                      <td className="px-4 py-2.5 tabular-nums">{c.open_tickets ? <span className="font-medium text-warning">{c.open_tickets}</span> : 0}</td>
                      <td className="px-4 py-2.5 tabular-nums">{c.pipeline_value ? formatMoney(c.pipeline_value) : "—"}</td>
                      <td className="px-4 py-2.5 text-muted">{c.last_activity_at ? relativeTime(c.last_activity_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
        </Card>
        {selected && <CustomerDrawer customerKey={selected} onClose={() => select(null)} />}
      </div>
    </>
  );
}

function CustomerDrawer({ customerKey, onClose }: { customerKey: string; onClose: () => void }) {
  const { data, error, loading, reload } = useApi<CustomerDetail>(`/api/customers/${encodeURIComponent(customerKey)}`);
  return (
    <Card className={DRAWER_CLASS}>
      <CardHeader
        title={data?.customer.name ?? "Customer"}
        description={data ? `${data.customer.kind === "registered" ? "Registered account" : "Guest (planned without signing in)"}${data.customer.email ? ` · ${data.customer.email}` : ""}` : undefined}
        action={
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-muted" aria-label="Close customer">
            <X className="h-5 w-5" />
          </button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} compact />
      ) : loading && !data ? (
        <SkeletonRows rows={8} />
      ) : data ? (
        <div className="space-y-5 p-5 text-sm">
          <Link
            href={`/admin/command-center?customer=${encodeURIComponent(customerKey)}&label=${encodeURIComponent(`Customer: ${data.customer.name}`)}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary-soft px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft/70"
          >
            <Sparkles className="h-4 w-4" aria-hidden /> Summarize with AI Command Center
          </Link>
          <Section title={`Trips (${data.trips.length})`}>
            {data.trips.map((t) => (
              <Link key={t.id} href={`/admin/trips?trip=${t.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-muted">
                <span>{t.title}</span>
                <span className="flex items-center gap-2">
                  {t.estimated_total ? <span className="text-xs tabular-nums text-muted">{formatMoney(t.estimated_total)}</span> : null}
                  <TripStatusBadge status={t.status} />
                </span>
              </Link>
            ))}
          </Section>
          {data.leads && (
            <Section title={`Sales leads (${data.leads.length})`}>
              {data.leads.map((l) => (
                <Link key={l.id} href={`/admin/leads?lead=${l.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-muted">
                  <span>
                    {l.destination ?? "No destination"} <span className="text-xs text-muted">· score {l.score} · {l.assignee_name ?? "unassigned"}</span>
                  </span>
                  <LeadStageBadge stage={l.stage} />
                </Link>
              ))}
            </Section>
          )}
          {data.tickets && (
            <Section title={`Support tickets (${data.tickets.length})`}>
              {data.tickets.map((t) => (
                <Link key={t.id} href={`/admin/support?ticket=${t.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-muted">
                  <span>
                    {t.ref} · {t.subject}
                  </span>
                  <span className="flex gap-1">
                    <PriorityBadge priority={t.priority} />
                    <TicketStatusBadge status={t.status} />
                  </span>
                </Link>
              ))}
            </Section>
          )}
          <Section title="Conversations">
            {data.conversations.map((c) => (
              <div key={c.id} className="rounded-md bg-surface-muted p-2.5 text-xs">
                <p className="font-medium text-slate-700">
                  {c.kind === "planner" ? "AI trip planner" : "Support chat"} · {c.messages} messages · {relativeTime(c.updated_at)}
                </p>
                {c.summary && <p className="mt-1 text-slate-700">{c.summary}</p>}
              </div>
            ))}
          </Section>
        </div>
      ) : null}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const empty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {empty ? <p className="text-muted">None.</p> : <div className="space-y-0.5">{children}</div>}
    </section>
  );
}
