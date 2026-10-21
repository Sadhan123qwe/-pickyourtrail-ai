"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Bot, Database, FileText, Lock, Sparkles, TriangleAlert, X } from "lucide-react";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { formatDateTime, relativeTime, titleCase, useDebounced } from "@/lib/client/format";
import type { AuditEvent, Employee } from "@/lib/client/types";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, SkeletonRows, Textarea, cn, DRAWER_CLASS } from "@/components/ui";
import { PriorityBadge, TicketStatusBadge } from "@/components/status";
import { useToast } from "@/components/feedback";
import { FIRST_RESPONSE_SLA_MINUTES, firstResponseSla } from "@/lib/workflows/sla";
import { SlaPill } from "./copilot";

interface CaseSummary {
  facts: { label: string; value: string; source: string }[];
  documents: { id: string; title: string; snippet: string; audience: string }[];
  answer: string;
  suggestions: string[];
  ai: { source: string; notice: string | null };
}

const SLA_TEXT = Object.entries(FIRST_RESPONSE_SLA_MINUTES)
  .map(([p, m]) => `${p} ${m < 60 ? `${m}m` : `${m / 60}h`}`)
  .join(" · ");

interface Ticket {
  id: string;
  ref: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  assignee_name: string | null;
  customer_name: string | null;
  contact_email: string | null;
  trip_title: string | null;
  trip_id: string | null;
  escalated: number;
  escalation_reason: string | null;
  first_response_at: string | null;
  csat_score: number | null;
  is_demo: number;
  message_count: number;
  created_at: string;
  updated_at: string;
}
interface Detail {
  ticket: Ticket;
  messages: { id: string; author_type: string; author_name: string | null; body: string; internal: boolean; created_at: string }[];
  allowedTransitions: string[];
  audit: AuditEvent[];
}

const STATUS_OPTIONS = [
  ["active", "Active (not resolved)"],
  ["", "All statuses"],
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["pending_customer", "Waiting on customer"],
  ["escalated", "Escalated"],
  ["resolved", "Resolved"],
  ["closed", "Closed"],
];

export function SupportOps({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("ticket");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [assignee, setAssignee] = useState("");
  const [escalated, setEscalated] = useState(false);
  const [sort, setSort] = useState("priority_desc");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const qs = new URLSearchParams({
    scope: "all", page: String(page), pageSize: "15", sort,
    ...(dq && { q: dq }), ...(status && { status }), ...(priority && { priority }), ...(category && { category }), ...(assignee && { assignedTo: assignee }), ...(escalated && { escalated: "true" }),
  });
  const list = useApi<{ items: Ticket[]; total: number; page: number; pageSize: number }>(`/api/support/tickets?${qs}`);
  const users = useApi<{ items: Employee[] }>("/api/users");
  const agents = (users.data?.items ?? []).filter((u) => u.role === "support" || u.role === "admin");
  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("ticket", id);
    else next.delete("ticket");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Support operations"
        description="Customer tickets from the support assistant and ticket form. Triage is automatic; humans own every reply."
        actions={<span className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted">First-response SLA: {SLA_TEXT}</span>}
      />
      <div className={cn("grid gap-6", selected && "2xl:grid-cols-[1fr_480px]")}>
        <Card className="min-w-0">
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input type="search" className="lg:col-span-2" aria-label="Search tickets" placeholder="Search ref, subject, customer" value={q} onChange={(e) => resetPage(setQ)(e.target.value)} />
            <Select aria-label="Status" value={status} onChange={(e) => resetPage(setStatus)(e.target.value)}>
              {STATUS_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <Select aria-label="Priority" value={priority} onChange={(e) => resetPage(setPriority)(e.target.value)}>
              <option value="">All priorities</option>
              {["urgent", "high", "normal", "low"].map((p) => (
                <option key={p} value={p}>
                  {titleCase(p)}
                </option>
              ))}
            </Select>
            <Select aria-label="Category" value={category} onChange={(e) => resetPage(setCategory)(e.target.value)}>
              <option value="">All categories</option>
              {["emergency", "cancellation_refund", "booking_change", "payment", "visa_documents", "itinerary_question", "general"].map((c) => (
                <option key={c} value={c}>
                  {titleCase(c)}
                </option>
              ))}
            </Select>
            <Select aria-label="Assignee" value={assignee} onChange={(e) => resetPage(setAssignee)(e.target.value)}>
              <option value="">Any assignee</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="priority_desc">Sort: priority</option>
              <option value="updated_desc">Sort: recently updated</option>
              <option value="created_asc">Sort: oldest first</option>
            </Select>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm">
              <input type="checkbox" checked={escalated} onChange={(e) => resetPage(setEscalated)(e.target.checked)} /> Escalated only
            </label>
          </div>
          {list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : list.loading && !list.data ? (
            <SkeletonRows rows={8} />
          ) : !list.data?.items.length ? (
            <EmptyState title="No tickets match" description="Adjust the filters to see more." />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((t) => (
                <li key={t.id}>
                  <button onClick={() => select(t.id)} className={cn("block w-full px-4 py-3 text-left hover:bg-surface-muted", selected === t.id && "bg-primary-soft/60")}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex items-center gap-1.5 font-medium">
                        {t.priority === "urgent" && <TriangleAlert className="h-4 w-4 shrink-0 text-tomato" aria-hidden />}
                        {t.subject}
                      </p>
                      <span className="whitespace-nowrap text-xs text-muted">{relativeTime(t.updated_at)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>{t.ref}</span>
                      <PriorityBadge priority={t.priority} />
                      <TicketStatusBadge status={t.status} />
                      <Badge>{titleCase(t.category)}</Badge>
                      <span>· {t.customer_name ?? t.contact_email ?? "Guest"}</span>
                      <span>· {t.assignee_name ?? "Unassigned"}</span>
                      <SlaInline t={t} />
                      {t.is_demo ? <span>· demo</span> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
        </Card>
        {selected && <TicketPanel id={selected} agents={agents} canWrite={canWrite} onClose={() => select(null)} onChanged={list.reload} />}
      </div>
    </>
  );
}

function SlaInline({ t }: { t: Ticket }) {
  const sla = firstResponseSla(t);
  if (!sla || sla.state === "met") return null;
  return <span className={cn("font-medium", sla.state === "breached" ? "text-danger" : sla.state === "at_risk" ? "text-warning" : "text-muted")}>· {sla.label}</span>;
}

function TicketPanel({ id, agents, canWrite, onClose, onChanged }: { id: string; agents: Employee[]; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi<Detail>(`/api/support/tickets/${id}`);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<CaseSummary | null>(null);
  const toast = useToast();

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      reload();
      onChanged();
      if (done) toast({ tone: "success", title: done });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const patch = (body: Record<string, unknown>, key: string, done?: string) => run(key, () => api(`/api/support/tickets/${id}`, { method: "PATCH", body }), done);

  async function summarize() {
    setBusy("summary");
    setErr(null);
    try {
      setSummary(await api<CaseSummary>("/api/copilot/chat", { body: { message: "Summarize this ticket", ticketId: id } }));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function draft() {
    setBusy("draft");
    setErr(null);
    try {
      const res = await api<{ draft: string | null; answer: string }>("/api/copilot/chat", { body: { message: "Draft a reply to this customer", ticketId: id } });
      setReply(res.draft ?? res.answer);
      setDrafted(true);
      setInternal(false);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className={DRAWER_CLASS}>
      <CardHeader
        title={data ? `${data.ticket.ref} · ${data.ticket.subject}` : "Ticket"}
        description={data ? `${data.ticket.customer_name ?? "Guest"}${data.ticket.contact_email ? ` · ${data.ticket.contact_email}` : ""}${data.ticket.trip_title ? ` · Trip: ${data.ticket.trip_title}` : ""}` : undefined}
        action={
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-muted" aria-label="Close ticket">
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
            <TicketStatusBadge status={data.ticket.status} />
            <PriorityBadge priority={data.ticket.priority} />
            <Badge>{titleCase(data.ticket.category)}</Badge>
            {data.ticket.csat_score && <Badge tone="green">CSAT {data.ticket.csat_score}/5</Badge>}
          </div>
          {(() => {
            const sla = firstResponseSla(data.ticket);
            return sla ? <SlaPill sla={sla} /> : null;
          })()}
          <div className="flex flex-wrap gap-3">
            {data.ticket.trip_id && (
              <Link href={`/admin/trips?trip=${data.ticket.trip_id}`} className="text-primary hover:underline">
                Related trip
              </Link>
            )}
            <Link href={`/admin/copilot?ticketId=${data.ticket.id}&label=${encodeURIComponent(`Ticket: ${data.ticket.ref}`)}`} className="inline-flex items-center gap-1 text-accent hover:underline">
              <Bot className="h-3.5 w-3.5" aria-hidden /> Ask the AI Copilot
            </Link>
          </div>
          <div className="ai-edge rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden /> AI case summary
              </p>
              <Button size="sm" variant={summary ? "secondary" : "ai"} loading={busy === "summary"} onClick={summarize}>
                {summary ? "Refresh" : "Summarize case"}
              </Button>
            </div>
            {summary ? (
              <div className="mt-2 space-y-2">
                {summary.ai.notice && <Alert tone="amber">{summary.ai.notice}</Alert>}
                <p className="text-slate-800">{summary.answer}</p>
                {summary.suggestions.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-700">
                    {summary.suggestions.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium text-muted">
                    <Database className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                    Source context · {summary.facts.length} record fields · {summary.documents.length} approved documents · {summary.ai.source === "mock" ? "rules" : summary.ai.source}
                  </summary>
                  <dl className="mt-1.5 space-y-0.5">
                    {summary.facts.map((f, i) => (
                      <div key={i} className="flex gap-2">
                        <dt className="shrink-0 text-muted">{f.label}:</dt>
                        <dd className="min-w-0 truncate">
                          {f.value} <span className="text-muted">({f.source})</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {summary.documents.map((d) => (
                    <p key={d.id} className="mt-1 flex items-center gap-1 text-muted">
                      <FileText className="h-3 w-3" aria-hidden /> {d.title} ({d.audience})
                    </p>
                  ))}
                </details>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">Generates a summary from this ticket&apos;s messages and approved knowledge, with the sources it used.</p>
            )}
          </div>
          {data.ticket.escalated ? <Alert tone="red" title="Escalated">{data.ticket.escalation_reason ?? "Needs human attention"}</Alert> : null}
          {err && <Alert tone="red">{err}</Alert>}

          {canWrite && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select aria-label="Assign ticket to" value={data.ticket.assigned_to ?? ""} onChange={(e) => patch({ assignedTo: e.target.value || null }, "assign", "Ticket assignment updated")}>
                <option value="">Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Ticket priority" value={data.ticket.priority} onChange={(e) => patch({ priority: e.target.value }, "priority", "Priority updated")}>
                {["urgent", "high", "normal", "low"].map((p) => (
                  <option key={p} value={p}>
                    {titleCase(p)} priority
                  </option>
                ))}
              </Select>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                {data.allowedTransitions.map((s) => (
                  <Button key={s} size="sm" variant={s === "escalated" ? "danger" : "secondary"} loading={busy === s} onClick={() => patch(s === "escalated" ? { escalate: true, escalationReason: "Escalated by agent" } : { status: s }, s, s === "escalated" ? "Ticket escalated" : `Ticket marked ${titleCase(s).toLowerCase()}`)}>
                    {s === "escalated" ? "Escalate" : `Mark ${titleCase(s).toLowerCase()}`}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <ol className="max-h-[360px] space-y-3 overflow-y-auto rounded-lg bg-surface-muted p-3">
            {data.messages.map((m) => (
              <li key={m.id} className={cn("rounded-lg p-3", m.internal ? "border border-warning/40 bg-warning-soft" : m.author_type === "customer" ? "bg-surface" : m.author_type === "system" ? "text-xs text-muted" : "bg-primary-soft")}>
                <p className="mb-1 flex items-center gap-1 text-xs text-muted">
                  {m.internal && <Lock className="h-3 w-3" aria-label="Internal note" />}
                  {m.author_type === "agent" ? (m.author_name ?? "Agent") : titleCase(m.author_type)} · {formatDateTime(m.created_at)}
                </p>
                <p className="whitespace-pre-line">{m.body}</p>
              </li>
            ))}
          </ol>

          {canWrite && data.ticket.status !== "closed" && (
            <div className="space-y-2">
              {drafted && <Alert tone="amber">AI-generated draft — review and edit before sending. It is not sent automatically.</Alert>}
              <Textarea aria-label="Reply" value={reply} maxLength={4000} onChange={(e) => setReply(e.target.value)} placeholder={internal ? "Internal note (customers can't see this)" : "Reply to the customer"} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
                  </label>
                  <Button size="sm" variant="ghost" onClick={draft} loading={busy === "draft"}>
                    <Bot className="h-4 w-4" aria-hidden /> Draft with copilot
                  </Button>
                </div>
                <Button
                  size="sm"
                  disabled={!reply.trim()}
                  loading={busy === "reply"}
                  onClick={() =>
                    run("reply", () => api(`/api/support/tickets/${id}/messages`, { body: { body: reply, internal } }), internal ? "Internal note added" : "Reply posted to the ticket").then(() => {
                      setReply("");
                      setDrafted(false);
                    })
                  }
                >
                  {internal ? "Add note" : "Send reply"}
                </Button>
              </div>
            </div>
          )}

          {data.audit.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">Audit history ({data.audit.length})</summary>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {data.audit.map((a) => (
                  <li key={a.id}>
                    {formatDateTime(a.created_at)} · {a.actor_label} · {a.action} {a.after_json && <code className="rounded bg-surface-muted px-1">{a.after_json}</code>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : null}
    </Card>
  );
}
