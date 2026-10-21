"use client";

import { RobotAvatar } from "@/components/robot";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Briefcase, ExternalLink, LifeBuoy, Search, Send, Sparkles, User, X } from "lucide-react";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { formatMoney, formatMonth, relativeTime, titleCase, useDebounced } from "@/lib/client/format";
import { firstResponseSla } from "@/lib/workflows/sla";
import { AiBadge, Alert, Badge, Button, Card, EmptyState, ErrorState, GlassPanel, Input, PageHeader, SkeletonRows, Tabs, TypingIndicator, cn } from "@/components/ui";
import { LeadStageBadge, PriorityBadge, TicketStatusBadge } from "@/components/status";
import { useToast } from "@/components/feedback";
import { ResponseCard, type AiAction, type CommandResponse } from "./ai-response";

type Ctx = { type: "lead" | "ticket" | "customer"; id: string; label: string; leadId?: string } | null;
interface Turn {
  id: string;
  question: string;
  context: string | null;
  response?: CommandResponse;
  error?: string;
}
interface SearchGroup {
  type: string;
  label: string;
  items: { id: string; title: string; subtitle: string; href: string }[];
}

const GENERAL_PROMPTS = [
  "Which leads need follow-up today?",
  "Summarize unresolved cases assigned to me",
  "Explain the approved cancellation policy",
  "What needs my attention right now?",
];
const CONTEXT_PROMPTS: Record<string, string[]> = {
  lead: ["Summarize this lead's travel requirements", "Draft a follow-up for this customer", "What should I do next with this lead?"],
  ticket: ["Summarize this ticket", "What does our policy say about this case?", "Escalate this ticket"],
  customer: ["Summarize this customer's requirements and conversation", "Draft a follow-up for this customer"],
};

/** Employee AI Copilot: a record-aware assistant over the shared, permission-checked tool layer. */
export function Copilot({ userName }: { userName: string }) {
  const params = useSearchParams();
  const [context, setContext] = useState<Ctx>(() => {
    const label = params.get("label");
    if (params.get("leadId")) return { type: "lead", id: params.get("leadId")!, label: label ?? "Selected lead", leadId: params.get("leadId")! };
    if (params.get("ticketId")) return { type: "ticket", id: params.get("ticketId")!, label: label ?? "Selected ticket" };
    if (params.get("customer")) return { type: "customer", id: params.get("customer")!, label: label ?? "Selected customer" };
    return null;
  });
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, AiAction>>({});
  const [side, setSide] = useState<"record" | "knowledge">("record");
  const end = useRef<HTMLDivElement>(null);
  const onLeadResolved = useCallback((leadId: string) => setContext((c) => (c && c.type === "customer" && !c.leadId ? { ...c, leadId } : c)), []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [turns, busy]);

  async function ask(question: string, ctx: Ctx = context) {
    const message = question.trim();
    if (!message || busy) return;
    const id = crypto.randomUUID();
    setTurns((t) => [...t, { id, question: message, context: ctx?.label ?? null }]);
    setBusy(true);
    try {
      const response = await api<CommandResponse>("/api/command/chat", {
        body: {
          message,
          context: ctx
            ? { leadId: ctx.type === "lead" ? ctx.id : (ctx.leadId ?? null), ticketId: ctx.type === "ticket" ? ctx.id : null, customerKey: ctx.type === "customer" ? ctx.id : null }
            : undefined,
        },
      });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, response } : x)));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: errorMessage(e) } : x)));
    } finally {
      setBusy(false);
    }
  }

  async function decide(actionId: string, decision: "confirm" | "reject") {
    try {
      const res = await api<{ action: AiAction }>(`/api/command/actions/${actionId}/${decision}`, { method: "POST" });
      setDecisions((d) => ({ ...d, [actionId]: res.action }));
    } catch (e) {
      setDecisions((d) => ({ ...d, [actionId]: { id: actionId, status: "failed", error: errorMessage(e), summary: null } as AiAction }));
    }
  }

  const prompts = context ? [...CONTEXT_PROMPTS[context.type], ...GENERAL_PROMPTS.slice(0, 2)] : GENERAL_PROMPTS;

  return (
    <>
      <PageHeader
        eyebrow={<AiBadge>Grounded in records you can access · changes need approval</AiBadge>}
        title="Employee AI Copilot"
        description="Ask about a lead, customer or case. Answers cite the records and approved knowledge they use; drafts are never sent automatically."
        actions={
          <Link href="/admin/command-center" className="text-[13px] font-medium text-primary hover:underline">
            Open AI Command Center →
          </Link>
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <RecordPicker context={context} onSelect={setContext} />

        <Card className="flex h-[calc(100vh-14.5rem)] min-h-[480px] min-w-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Copilot conversation
              </p>
              <p className="truncate text-xs text-muted">{context ? `Working on: ${context.label}` : "No record selected — ask about your queues, policies or the business."}</p>
            </div>
            {turns.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setTurns([])}>
                Clear
              </Button>
            )}
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto bg-surface-muted/40 p-4" aria-live="polite">
            {turns.length === 0 && (
              <div className="mx-auto max-w-xl space-y-3 py-4">
                <p className="text-sm text-muted">Hi {userName.split(" ")[0]} — pick a prompt or type your own.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {prompts.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={busy}
                      onClick={() => ask(p)}
                      className="rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-[13px] transition-colors hover:border-accent/40 hover:bg-accent-soft/50"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className="space-y-2">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-md border border-lavender/60 bg-lavender-surface px-3 py-2 text-sm text-foreground">
                  {t.question}
                  {t.context && <span className="mt-0.5 block text-[11px] text-muted">Context: {t.context}</span>}
                </div>
                <div className="flex gap-2.5">
                  <RobotAvatar size={32} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    {!t.response && !t.error && (
                      <div className="w-fit rounded-2xl rounded-tl-md border border-border bg-surface px-3 py-2.5">
                        <TypingIndicator label="The copilot is checking records" />
                      </div>
                    )}
                    {t.error && (
                      <Alert tone="red">
                        {t.error}{" "}
                        <button type="button" className="font-medium underline" disabled={busy} onClick={() => ask(t.question)}>
                          Retry
                        </button>
                      </Alert>
                    )}
                    {t.response && <ResponseCard r={t.response} decisions={decisions} onDecide={decide} />}
                  </div>
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <form
            className="space-y-2 border-t border-border bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const m = input;
              setInput("");
              void ask(m);
            }}
          >
            {context && (
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent">
                  {context.label}
                  <button type="button" onClick={() => setContext(null)} aria-label="Remove context" className="rounded-full hover:bg-accent/10">
                    <X className="h-3 w-3" />
                  </button>
                </span>
                {turns.length > 0 &&
                  CONTEXT_PROMPTS[context.type].slice(0, 2).map((p) => (
                    <button key={p} type="button" disabled={busy} onClick={() => ask(p)} className="rounded-full border border-border px-2.5 py-0.5 text-xs hover:border-accent/40 hover:bg-accent-soft/50">
                      {p}
                    </button>
                  ))}
              </div>
            )}
            <div className="flex gap-2">
              <label htmlFor="copilot-input" className="sr-only">
                Ask the Employee AI Copilot
              </label>
              <input
                id="copilot-input"
                value={input}
                maxLength={1500}
                onChange={(e) => setInput(e.target.value)}
                placeholder={context ? `Ask about ${context.label}…` : "Ask about leads, cases, policies…"}
                className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              <Button type="submit" variant="ai" loading={busy} disabled={!input.trim()}>
                <Send className="h-4 w-4" aria-hidden /> Ask
              </Button>
            </div>
          </form>
        </Card>

        <div className="min-w-0 lg:col-span-2 2xl:col-span-1">
          <Card className="overflow-hidden 2xl:sticky 2xl:top-20">
            <div className="px-3 pt-1">
              <Tabs
                tabs={[
                  { value: "record" as const, label: "Selected record" },
                  { value: "knowledge" as const, label: "Knowledge search" },
                ]}
                value={side}
                onChange={setSide}
              />
            </div>
            <div className="max-h-[calc(100vh-14rem)] overflow-y-auto p-4">
              {side === "record" ? (
                <RecordSummary context={context} onAsk={(q) => ask(q)} onLeadResolved={onLeadResolved} />
              ) : (
                <KnowledgeSearch onAsk={(q) => ask(q, null)} />
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function RecordPicker({ context, onSelect }: { context: Ctx; onSelect: (c: Ctx) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const res = useApi<{ groups: SearchGroup[] }>(dq.length >= 2 ? `/api/search?q=${encodeURIComponent(dq)}` : null);
  const recentLeads = useApi<{ items: { id: string; name: string; destination: string | null; stage: string }[] }>("/api/leads?pageSize=6&sort=follow_up_asc");
  const groups = (res.data?.groups ?? []).filter((g) => ["lead", "customer", "ticket"].includes(g.type) && g.items.length);
  const ICON = { lead: Briefcase, customer: User, ticket: LifeBuoy } as Record<string, typeof Briefcase>;

  return (
    <GlassPanel className="p-3 lg:sticky lg:top-20">
      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Record context</p>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a lead, customer or ticket" aria-label="Find a record for the copilot" className="pl-8" />
      </div>
      <div className="mt-2 max-h-[50vh] space-y-3 overflow-y-auto">
        {dq.length >= 2 ? (
          res.loading && !res.data ? (
            <SkeletonRows rows={3} />
          ) : groups.length ? (
            groups.map((g) => (
              <div key={g.type}>
                <p className="px-1 text-[11px] font-medium text-muted">{g.label}</p>
                <ul className="mt-1 space-y-0.5">
                  {g.items.map((it) => {
                    const Icon = ICON[g.type];
                    const selected = context?.id === it.id;
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => onSelect({ type: g.type as "lead" | "ticket" | "customer", id: it.id, label: `${titleCase(g.type)}: ${it.title}`, leadId: g.type === "lead" ? it.id : undefined })}
                          className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-muted", selected && "bg-accent-soft")}
                        >
                          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{it.title}</span>
                            <span className="block truncate text-xs text-muted">{it.subtitle}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          ) : (
            <p className="px-1 py-2 text-xs text-muted">No matching leads, customers or tickets you can access.</p>
          )
        ) : (
          <div>
            <p className="px-1 text-[11px] font-medium text-muted">Leads by next follow-up</p>
            {recentLeads.error ? (
              <p className="px-1 py-2 text-xs text-muted">Lead list isn&apos;t available for your role.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {(recentLeads.data?.items ?? []).map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => onSelect({ type: "lead", id: l.id, label: `Lead: ${l.name}`, leadId: l.id })}
                      className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-muted", context?.id === l.id && "bg-accent-soft")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{l.name}</span>
                        <span className="block truncate text-xs text-muted">{l.destination ?? "No destination yet"}</span>
                      </span>
                      <LeadStageBadge stage={l.stage} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {context && (
        <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => onSelect(null)}>
          Clear selected record
        </Button>
      )}
    </GlassPanel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function RecordSummary({ context, onAsk, onLeadResolved }: { context: Ctx; onAsk: (q: string) => void; onLeadResolved: (leadId: string) => void }) {
  const path = !context ? null : context.type === "lead" ? `/api/leads/${context.id}` : context.type === "ticket" ? `/api/support/tickets/${context.id}` : `/api/customers/${encodeURIComponent(context.id)}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error, loading, reload } = useApi<any>(path);
  const customerLead: string | undefined = context?.type === "customer" ? data?.leads?.find((l: { stage: string }) => !["won", "lost"].includes(l.stage))?.id : undefined;
  useEffect(() => {
    if (customerLead) onLeadResolved(customerLead);
  }, [customerLead, onLeadResolved]);

  if (!context) {
    return <EmptyState icon={<User className="h-6 w-6" />} title="No record selected" description="Search for a lead, customer or ticket on the left to ground the copilot in that record." />;
  }
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <SkeletonRows rows={5} />;

  if (context.type === "lead") {
    const l = data.lead;
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{l.name}</p>
            <p className="text-xs text-muted">{l.email ?? l.phone ?? "No contact details"}</p>
          </div>
          <LeadStageBadge stage={l.stage} />
        </div>
        {data.nextAction && (
          <div className={cn("rounded-lg border p-3", data.nextAction.urgency === "high" ? "border-warning/40 bg-warning-soft" : "border-accent/30 bg-accent-soft/60")}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Suggested next action · rule-based</p>
            <p className="mt-1 text-[13px] font-medium">{data.nextAction.action}</p>
            <p className="text-xs text-muted">{data.nextAction.reason}</p>
          </div>
        )}
        <dl className="divide-y divide-border">
          <Field label="Destination">{l.destination ?? "—"}</Field>
          <Field label="Travel month">{l.travel_month ? formatMonth(l.travel_month) : "—"}</Field>
          <Field label="Travellers">{l.travellers ?? "—"}</Field>
          <Field label="Budget">{l.budget ? formatMoney(l.budget) : "—"}</Field>
          <Field label="Est. value">{l.estimated_value ? `${formatMoney(l.estimated_value)} (estimate)` : "—"}</Field>
          <Field label="Owner">{l.assignee_name ?? "Unassigned"}</Field>
        </dl>
        {(data.preferences?.summary || data.conversation) && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Conversation summary</p>
            <p className="mt-1 text-[13px] text-slate-700">{data.conversation ?? data.preferences.summary}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ai" onClick={() => onAsk("Summarize this lead's travel requirements")}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Summarize
          </Button>
          <Link href={`/admin/leads?lead=${l.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium hover:bg-surface-muted">
            Open lead <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  if (context.type === "ticket") {
    const t = data.ticket;
    const sla = firstResponseSla(t);
    const last = (data.messages ?? []).slice(-3);
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs text-muted">{t.ref}</p>
          <p className="font-semibold">{t.subject}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <PriorityBadge priority={t.priority} />
            <TicketStatusBadge status={t.status} />
            {t.escalated ? <Badge tone="red">Escalated</Badge> : null}
          </div>
        </div>
        {sla && <SlaPill sla={sla} />}
        <dl className="divide-y divide-border">
          <Field label="Category">{titleCase(t.category.replace(/_/g, " "))}</Field>
          <Field label="Opened">{relativeTime(t.created_at)}</Field>
          <Field label="Messages">{data.messages?.length ?? 0}</Field>
        </dl>
        {last.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Latest messages</p>
            <ul className="mt-1 space-y-2">
              {last.map((m: { id: string; author_type: string; author_name: string | null; body: string; internal: boolean }) => (
                <li key={m.id} className="rounded-md bg-surface-muted/70 px-2.5 py-1.5 text-xs">
                  <span className="font-medium">{m.author_name ?? titleCase(m.author_type)}</span>
                  {m.internal && <span className="text-warning"> · internal</span>}
                  <span className="mt-0.5 line-clamp-3 block text-slate-700">{m.body}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ai" onClick={() => onAsk("Summarize this ticket")}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Summarize
          </Button>
          <Link href={`/admin/support?ticket=${t.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium hover:bg-surface-muted">
            Open ticket <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  const c = data.customer;
  return (
    <div className="space-y-4">
      <div>
        <p className="font-semibold">{c.name}</p>
        <p className="text-xs text-muted">
          {c.kind === "registered" ? "Registered customer" : "Guest"}
          {c.email ? ` · ${c.email}` : ""}
        </p>
      </div>
      <dl className="divide-y divide-border">
        <Field label="Trips">{c.trips}</Field>
        <Field label="Open leads">{c.open_leads}</Field>
        <Field label="Open tickets">{c.open_tickets}</Field>
        <Field label="Pipeline (estimate)">{c.pipeline_value ? formatMoney(c.pipeline_value) : "—"}</Field>
        <Field label="Last activity">{relativeTime(c.last_activity_at)}</Field>
      </dl>
      {data.trips?.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Trips</p>
          <ul className="mt-1 space-y-1 text-[13px]">
            {data.trips.slice(0, 4).map((t: { id: string; title: string; status: string }) => (
              <li key={t.id} className="flex justify-between gap-2">
                <Link href={`/admin/trips?trip=${t.id}`} className="truncate hover:text-primary">
                  {t.title}
                </Link>
                <span className="shrink-0 text-xs text-muted">{t.status.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ai" onClick={() => onAsk("Summarize this customer's requirements and conversation")}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Summarize
        </Button>
        <Link href={`/admin/customers?customer=${encodeURIComponent(c.key)}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium hover:bg-surface-muted">
          Open customer <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

export function SlaPill({ sla }: { sla: { state: string; label: string } }) {
  const tone = sla.state === "breached" ? "border-danger/30 bg-danger-soft text-danger" : sla.state === "at_risk" ? "border-warning/30 bg-warning-soft text-warning" : sla.state === "met" ? "border-success/30 bg-success-soft text-success" : "border-border bg-surface-muted text-slate-700";
  return <p className={cn("rounded-md border px-2.5 py-1.5 text-xs font-medium", tone)}>SLA · {sla.label}</p>;
}

function KnowledgeSearch({ onAsk }: { onAsk: (q: string) => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const res = useApi<{ hits: { id: string; title: string; category: string; audience: string; snippet: string; isDemo: boolean }[] }>(dq.length >= 2 ? `/api/copilot/knowledge?q=${encodeURIComponent(dq)}` : null);
  return (
    <div className="space-y-3">
      <div className="relative">
        <BookOpen className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search approved policies & SOPs" aria-label="Search company knowledge" className="pl-8" />
      </div>
      {dq.length < 2 ? (
        <p className="text-xs text-muted">Search approved documents — cancellation terms, visa guidance, sales playbook, support SOP. Results come only from the Knowledge Base.</p>
      ) : res.loading && !res.data ? (
        <SkeletonRows rows={3} />
      ) : res.error ? (
        <ErrorState error={res.error} onRetry={res.reload} />
      ) : res.data?.hits.length ? (
        <ul className="space-y-2">
          {res.data.hits.map((h) => (
            <li key={h.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-medium">{h.title}</p>
                <Badge tone={h.audience === "internal" ? "amber" : "neutral"}>{h.audience}</Badge>
              </div>
              <p className="mt-1 line-clamp-4 text-xs text-slate-600">{h.snippet}</p>
              <div className="mt-2 flex gap-3 text-xs">
                <button type="button" className="font-medium text-accent hover:underline" onClick={() => onAsk(`Explain the approved ${h.title}`)}>
                  Explain with AI
                </button>
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${h.title}\n\n${h.snippet}`);
                      toast({ tone: "success", title: "Excerpt copied" });
                    } catch {
                      toast({ tone: "error", title: "Couldn't access the clipboard" });
                    }
                  }}
                >
                  Copy excerpt
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No approved document matches &ldquo;{dq}&rdquo;. The copilot won&apos;t guess policy that isn&apos;t documented.</p>
      )}
    </div>
  );
}
