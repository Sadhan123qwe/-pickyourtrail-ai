"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Info, X } from "lucide-react";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { formatDate, formatDateTime, formatMoney, relativeTime, useDebounced } from "@/lib/client/format";
import type { AuditEvent, Employee, Handoff } from "@/lib/client/types";
import { Alert, Badge, Button, Card, CardHeader, DRAWER_CLASS, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, SkeletonRows, Textarea, Timeline, cn } from "@/components/ui";
import { BookingLifecycle, OpsStatusBadge, ProviderStatusBadge } from "@/components/status";
import { useConfirm, useToast } from "@/components/feedback";

function auditTitle(a: AuditEvent): string {
  const after = (() => {
    try {
      return a.after_json ? (JSON.parse(a.after_json) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();
  if (a.action === "requested") return "Customer submitted the booking request";
  if (a.action === "note" && typeof after.note === "string") return `Note: ${after.note}`;
  const parts: string[] = [];
  if (typeof after.opsStatus === "string") parts.push(`status → ${OPS_LABEL[after.opsStatus] ?? after.opsStatus}`);
  if ("assignedTo" in after) parts.push(after.assignedTo ? "reassigned" : "unassigned");
  if (typeof after.quotedTotal === "number") parts.push(`quote recorded ${formatMoney(after.quotedTotal)}`);
  if (typeof after.note === "string") parts.push(`note: ${after.note}`);
  return parts.length ? parts.join(" · ").replace(/^./, (c) => c.toUpperCase()) : a.action;
}

const OPS_LABEL: Record<string, string> = {
  pending: "Pending review",
  in_review: "In review",
  quote_sent: "Quote sent",
  customer_accepted: "Customer accepted",
  failed: "Failed",
  cancelled: "Cancelled",
};

interface HandoffList {
  items: Handoff[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  provider: { name: string; live: boolean };
}

/** Booking Operations: every customer booking request, its operational state, failures and audit trail. */
export function BookingOperations({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("handoff");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const qs = new URLSearchParams({ page: String(page), pageSize: "15", ...(status && { status }), ...(dq && { q: dq }) });
  const list = useApi<HandoffList>(`/api/operations/handoffs?${qs}`);
  const users = useApi<{ items: Employee[] }>("/api/users");
  const staff = (users.data?.items ?? []).filter((u) => u.role === "ops" || u.role === "admin");
  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("handoff", id);
    else next.delete("handoff");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const counts = list.data?.counts ?? {};
  const actionNeeded = (counts.pending ?? 0) + (counts.in_review ?? 0);
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title="Booking operations" description="Customer booking requests handed to travel experts: review, quote, follow through, and resolve failures." />
      <Alert tone="blue" className="mb-4">
        <span className="inline-flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          No booking provider is connected ({list.data?.provider.name ?? "demo adapter"}). Provider confirmation can only be recorded by a provider integration, so nothing here is shown as a confirmed booking.
        </span>
      </Alert>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by operational status">
        <Button size="sm" variant={status === "" ? "primary" : "secondary"} onClick={() => (setStatus(""), setPage(1))}>
          All <span className="ml-1 opacity-75">{all}</span>
        </Button>
        {Object.entries(OPS_LABEL).map(([k, label]) => (
          <Button
            key={k}
            size="sm"
            variant={status === k ? "primary" : "secondary"}
            onClick={() => (setStatus(k), setPage(1))}
            className={cn(k === "failed" && (counts.failed ?? 0) > 0 && status !== k && "border-danger/40 text-danger")}
          >
            {label} <span className="ml-1 opacity-75">{counts[k] ?? 0}</span>
          </Button>
        ))}
        {actionNeeded > 0 && <Badge tone="amber">{actionNeeded} need action</Badge>}
      </div>
      <div className={cn("grid gap-6", selected && "2xl:grid-cols-[1fr_460px]")}>
        <Card className="min-w-0">
          <div className="border-b border-border p-4">
            <Input type="search" aria-label="Search booking requests" placeholder="Search trip, customer, destination" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
          </div>
          {list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : list.loading && !list.data ? (
            <SkeletonRows rows={6} />
          ) : !list.data?.items.length ? (
            <EmptyState title="No booking requests" description="Requests appear here when customers confirm a booking request on the review page." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Trip</th>
                    <th className="px-4 py-2 font-medium">Customer</th>
                    <th className="px-4 py-2 font-medium">Ops status</th>
                    <th className="px-4 py-2 font-medium">Provider</th>
                    <th className="px-4 py-2 font-medium">Estimate</th>
                    <th className="px-4 py-2 font-medium">Owner</th>
                    <th className="px-4 py-2 font-medium">Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((h) => (
                    <tr key={h.id} onClick={() => select(h.id)} className={cn("cursor-pointer border-b border-border/60 hover:bg-surface-muted", selected === h.id && "bg-primary-soft/60")}>
                      <td className="px-4 py-2.5">
                        <button className="text-left font-medium hover:text-primary">{h.trip_title}</button>
                        <p className="text-xs text-muted">
                          {h.travellers ? `${h.travellers} pax` : ""} {h.start_date ? `· ${formatDate(h.start_date)}` : ""} {h.is_demo ? "· demo" : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        {h.contact_name}
                        <p className="text-xs text-muted">{h.contact_email}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <OpsStatusBadge status={h.ops_status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <ProviderStatusBadge status={h.provider_status} reference={h.provider_reference} />
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{h.estimated_total ? formatMoney(h.estimated_total) : "—"}</td>
                      <td className="px-4 py-2.5">{h.assignee_name ?? <span className="text-muted">Unassigned</span>}</td>
                      <td className="px-4 py-2.5 text-muted">{relativeTime(h.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
        </Card>
        {selected && <HandoffPanel id={selected} staff={staff} canWrite={canWrite} onClose={() => select(null)} onChanged={list.reload} />}
      </div>
    </>
  );
}

function HandoffPanel({ id, staff, canWrite, onClose, onChanged }: { id: string; staff: Employee[]; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi<{ handoff: Handoff; allowedTransitions: string[]; audit: AuditEvent[] }>(`/api/bookings/handoff/${id}`);
  const [quote, setQuote] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const patch = async (body: Record<string, unknown>, key: string, done?: string) => {
    setBusy(key);
    setErr(null);
    try {
      await api(`/api/bookings/handoff/${id}`, { method: "PATCH", body });
      reload();
      onChanged();
      if (done) toast({ tone: "success", title: done });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const h = data?.handoff;
  return (
    <Card className={DRAWER_CLASS}>
      <CardHeader
        title={h?.trip_title ?? "Booking handoff"}
        description={h ? `${h.contact_name} · ${h.contact_email}${h.contact_phone ? ` · ${h.contact_phone}` : ""}` : undefined}
        action={
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} compact />
      ) : loading && !h ? (
        <SkeletonRows rows={6} />
      ) : h && data ? (
        <div className="space-y-4 p-5 text-sm">
          <div className="flex flex-wrap gap-2">
            <OpsStatusBadge status={h.ops_status} />
            <ProviderStatusBadge status={h.provider_status} reference={h.provider_reference} />
            {h.is_demo ? <Badge tone="amber">Demo record</Badge> : null}
          </div>
          {err && <Alert tone="red">{err}</Alert>}
          <div className="rounded-lg border border-border bg-surface-muted/50 p-3">
            <BookingLifecycle hasItinerary opsStatus={h.ops_status} providerStatus={h.provider_status} />
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted">Customer confirmed</dt>
              <dd>{formatDateTime(h.customer_confirmed_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Estimate</dt>
              <dd>{h.estimated_total ? formatMoney(h.estimated_total) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Quoted total</dt>
              <dd>{h.quoted_total ? formatMoney(h.quoted_total) : "Not quoted"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Provider adapter</dt>
              <dd>{h.provider} (not live)</dd>
            </div>
          </dl>
          <blockquote className="rounded-lg border-l-4 border-primary/40 bg-surface-muted p-3 text-xs text-slate-700">
            Customer confirmation: &ldquo;{h.confirmation_text}&rdquo;
          </blockquote>
          {h.notes && <p className="text-slate-700">Customer notes: {h.notes}</p>}
          <Link href={`/admin/trips?trip=${h.trip_id}`} className="text-primary hover:underline">
            Open trip & itinerary
          </Link>
          {canWrite ? (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                {data.allowedTransitions.map((s) => (
                  <Button key={s} size="sm" variant={s === "failed" || s === "cancelled" ? "danger" : "secondary"} loading={busy === s} onClick={async () => {
                      if (
                        (s === "failed" || s === "cancelled") &&
                        !(await confirm({ title: `Mark this request as ${OPS_LABEL[s].toLowerCase()}?`, description: "The customer's trip page will show this status. This is recorded in the audit history.", confirmLabel: `Mark ${OPS_LABEL[s].toLowerCase()}`, tone: "danger" }))
                      )
                        return;
                      void patch({ opsStatus: s }, s, `Status: ${OPS_LABEL[s]}`);
                    }}>
                    {OPS_LABEL[s]}
                  </Button>
                ))}
              </div>
              <Select aria-label="Assign to" value={h.assigned_to ?? ""} onChange={(e) => patch({ assignedTo: e.target.value || null }, "assign", "Assignment updated")}>
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (quote) void patch({ quotedTotal: Math.round(Number(quote)) }, "quote", "Quote recorded").then(() => setQuote(""));
                }}
              >
                <Input type="number" min={0} aria-label="Quoted total in INR" placeholder="Quoted total (INR)" value={quote} onChange={(e) => setQuote(e.target.value)} />
                <Button type="submit" variant="secondary" loading={busy === "quote"}>
                  Record quote
                </Button>
              </form>
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (note.trim()) void patch({ note: note.trim() }, "note", "Operational note added").then(() => setNote(""));
                }}
              >
                <Textarea aria-label="Operational note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Operational note — supplier contacted, availability, next step… (internal)" className="min-h-[70px]" />
                <div className="flex justify-end">
                  <Button type="submit" size="sm" variant="secondary" disabled={!note.trim()} loading={busy === "note"}>
                    Add note
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <p className="text-xs text-muted">Read-only for your role.</p>
          )}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Notes &amp; audit history</h3>
            {data.audit.length === 0 ? (
              <p className="text-xs text-muted">No changes recorded yet.</p>
            ) : (
              <Timeline
                items={data.audit.map((a) => ({
                  id: a.id,
                  title: auditTitle(a),
                  meta: `${a.actor_label} · ${formatDateTime(a.created_at)}`,
                  tone: a.action === "note" ? "amber" : a.action === "requested" ? "teal" : "blue",
                }))}
              />
            )}
          </section>
        </div>
      ) : null}
    </Card>
  );
}

