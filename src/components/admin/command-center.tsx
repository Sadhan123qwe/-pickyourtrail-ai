"use client";

import { RobotAvatar } from "@/components/robot";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Send, Sparkles, X } from "lucide-react";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { formatDateTime, formatMoney, relativeTime, titleCase } from "@/lib/client/format";
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Tabs, cn } from "@/components/ui";
import { LeadStageBadge, OpsStatusBadge, PriorityBadge } from "@/components/status";
import { ActionStatusIcon, ApprovalRow, ResponseCard, TOOL_LABEL, type AiAction, type CommandResponse } from "./ai-response";

interface Turn {
  id: string;
  question: string;
  context: string | null;
  response?: CommandResponse;
  error?: string;
}
interface Overview {
  queues: {
    approvals: AiAction[];
    exceptions: { type: string; severity: string; title: string; detail: string; entityId: string | null; at: string }[];
    stalledLeads: { id: string; name: string; destination: string | null; stage: string; estimated_value: number | null; assignee_name: string | null; trip_status: string; last_activity_at: string; is_demo: number }[] | null;
    followUpsDue: { id: string; lead_id: string; lead_name: string; channel: string; due_at: string; assignee_name: string | null; overdue: number }[] | null;
    urgentSupport: { id: string; ref: string; subject: string; priority: string; reason: string; assignee_name: string | null; created_at: string }[] | null;
    handoffs: { id: string; trip_id: string; trip_title: string; contact_name: string; ops_status: string; assignee_name: string | null; age_hours: number }[] | null;
    tripsAwaitingReview: { id: string; title: string; customer: string | null; estimated_total: number | null; updated_at: string }[] | null;
    activeConversations: { id: string; kind: string; trip_id: string | null; trip_title: string | null; customer: string | null; summary: string | null; updated_at: string; messages: number }[] | null;
    overBudget: { trip_id: string; title: string; customer: string | null; total: number; budget_inr: number; over_pct: number; lead_id: string | null }[] | null;
    recentActions: AiAction[];
  };
}
type Context = { leadId?: string; ticketId?: string; customerKey?: string; label: string } | null;

const PROMPTS = [
  "Show me leads who planned a trip but haven't continued to booking",
  "Find support cases that need urgent attention",
  "Show trips where the budget exceeds the customer's stated limit",
  "Summarize today's operational exceptions",
  "What needs my attention right now?",
  "How is the business doing this month?",
];

export function CommandCenter({ userName }: { userName: string }) {
  const params = useSearchParams();
  const overview = useApi<Overview>("/api/command/overview");
  const [tab, setTab] = useState<string>("approvals");
  const [context, setContext] = useState<Context>(() => {
    const leadId = params.get("leadId");
    const ticketId = params.get("ticketId");
    const customer = params.get("customer");
    if (leadId) return { leadId, label: params.get("label") ?? "Selected lead" };
    if (ticketId) return { ticketId, label: params.get("label") ?? "Selected ticket" };
    if (customer) return { customerKey: customer, label: params.get("label") ?? "Selected customer" };
    return null;
  });
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, AiAction>>({});
  const consoleEnd = useRef<HTMLDivElement>(null);
  const history = useApi<{ messages: { id: string; role: string; content: string; meta: Record<string, unknown> | null }[]; actions: AiAction[] }>("/api/command/chat");

  useEffect(() => {
    consoleEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  const q = overview.data?.queues;
  const ctxLabel = context?.label ?? null;

  async function ask(question: string, ctx: Context = context) {
    const message = question.trim();
    if (!message) return;
    const id = crypto.randomUUID();
    setTurns((t) => [...t, { id, question: message, context: ctx?.label ?? null }]);
    setBusy(true);
    try {
      const response = await api<CommandResponse>("/api/command/chat", {
        body: { message, context: ctx ? { leadId: ctx.leadId ?? null, ticketId: ctx.ticketId ?? null, customerKey: ctx.customerKey ?? null } : undefined },
      });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, response } : x)));
      if (response.toolCalls.some((c) => c.status === "proposed")) overview.reload();
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
      overview.reload();
    } catch (e) {
      setDecisions((d) => ({ ...d, [actionId]: { id: actionId, status: "failed", error: errorMessage(e), summary: null } as AiAction }));
    }
  }

  function askAbout(ctx: Context, question: string) {
    setContext(ctx);
    void ask(question, ctx);
  }

  const tabs = [
    { value: "approvals", label: "Approvals", count: q?.approvals.length },
    { value: "exceptions", label: "Exceptions", count: q?.exceptions.length },
    ...(q?.stalledLeads ? [{ value: "leads", label: "Leads needing attention", count: q.stalledLeads.length }] : []),
    ...(q?.followUpsDue ? [{ value: "followups", label: "Follow-ups due", count: q.followUpsDue.length }] : []),
    ...(q?.urgentSupport ? [{ value: "support", label: "Support escalations", count: q.urgentSupport.length }] : []),
    ...(q?.handoffs ? [{ value: "handoffs", label: "Booking handoffs", count: q.handoffs.length }] : []),
    ...(q?.tripsAwaitingReview ? [{ value: "review", label: "Awaiting customer review", count: q.tripsAwaitingReview.length }] : []),
    ...(q?.activeConversations ? [{ value: "conversations", label: "Active conversations", count: q.activeConversations.length }] : []),
    { value: "actions", label: "Recent AI actions", count: q?.recentActions.length },
  ];

  const persisted = (history.data?.messages ?? []).filter((m) => m.role === "assistant").length;

  return (
    <>
      <PageHeader
        eyebrow={<Badge tone="blue">Shared AI orchestration · validated tools · human approval</Badge>}
        title="AI Command Center"
        description="Operational queues computed from live records, and an AI console that can only act through authorized business tools."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {[
          ["Approvals", q?.approvals.length, "approvals", q && q.approvals.length > 0 ? "amber" : null],
          ["Exceptions", q?.exceptions.length, "exceptions", q && q.exceptions.some((e) => e.severity === "high") ? "red" : null],
          ["Stalled leads", q?.stalledLeads?.length, "leads", null],
          ["Follow-ups due", q?.followUpsDue?.length, "followups", q?.followUpsDue?.some((f) => f.overdue) ? "amber" : null],
          ["Support escalations", q?.urgentSupport?.length, "support", q?.urgentSupport?.length ? "red" : null],
          ["Handoffs to action", q?.handoffs?.length, "handoffs", null],
          ["Awaiting review", q?.tripsAwaitingReview?.length, "review", null],
          ["Active chats", q?.activeConversations?.length, "conversations", null],
        ].map(([label, value, key, tone]) => (
          <button
            key={key as string}
            onClick={() => setTab(key as string)}
            disabled={value === undefined || value === null}
            className={cn(
              "rounded-lg border bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary/40 disabled:cursor-default disabled:opacity-50",
              tab === key ? "border-primary ring-1 ring-primary/30" : "border-border",
            )}
          >
            <span className="block text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
            <span className={cn("mt-1 block text-xl font-semibold tabular-nums", tone === "red" ? "text-danger" : tone === "amber" ? "text-warning" : "text-foreground")}>
              {value === null ? "—" : (value ?? "·")}
            </span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card className="min-w-0 self-start">
          <div className="px-4 pt-2">
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
          </div>
          {overview.error ? (
            <ErrorState error={overview.error} onRetry={overview.reload} />
          ) : !q ? (
            <SkeletonRows rows={6} />
          ) : (
            <div className="max-h-[640px] overflow-y-auto">
              {tab === "approvals" &&
                (q.approvals.length ? (
                  <ul className="divide-y divide-border">
                    {q.approvals.map((a) => (
                      <ApprovalRow key={a.id} action={decisions[a.id] ?? a} onDecide={decide} />
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={<Check className="h-6 w-6" />} title="No actions waiting for approval" description="When the AI proposes a change (e.g. scheduling a follow-up), it waits here for you." />
                ))}
              {tab === "exceptions" &&
                (q.exceptions.length ? (
                  <ul className="divide-y divide-border">
                    {q.exceptions.map((e, i) => (
                      <li key={i} className="flex items-start gap-3 px-5 py-3 text-sm">
                        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", e.severity === "high" ? "text-danger" : "text-warning")} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{e.title}</p>
                          <p className="text-muted">{e.detail}</p>
                        </div>
                        <span className="whitespace-nowrap text-xs text-muted">{relativeTime(e.at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No exceptions today" />
                ))}
              {tab === "leads" && q.stalledLeads && (
                <QueueTable
                  empty="Every lead with an itinerary has requested a booking."
                  head={["Lead", "Stage", "Est. value", "Owner", "Last activity", ""]}
                  rows={q.stalledLeads.map((l) => [
                    <Link key="n" href={`/admin/leads?lead=${l.id}`} className="font-medium hover:text-primary">
                      {l.name}
                      <span className="block text-xs font-normal text-muted">
                        {l.destination} · trip {l.trip_status.replace(/_/g, " ")}
                        {l.is_demo ? " · demo" : ""}
                      </span>
                    </Link>,
                    <LeadStageBadge key="s" stage={l.stage} />,
                    l.estimated_value ? formatMoney(l.estimated_value) : "—",
                    l.assignee_name ?? "Unassigned",
                    relativeTime(l.last_activity_at),
                    <Button key="a" size="sm" variant="ghost" onClick={() => askAbout({ leadId: l.id, label: `Lead: ${l.name}` }, "Summarize this customer's requirements and conversation")}>
                      <Sparkles className="h-3.5 w-3.5" aria-hidden /> Ask AI
                    </Button>,
                  ])}
                />
              )}
              {tab === "followups" && q.followUpsDue && (
                <QueueTable
                  empty="No follow-ups due today."
                  head={["Lead", "Channel", "Due", "Owner", ""]}
                  rows={q.followUpsDue.map((f) => [
                    <Link key="n" href={`/admin/leads?lead=${f.lead_id}`} className="font-medium hover:text-primary">
                      {f.lead_name}
                    </Link>,
                    titleCase(f.channel),
                    <span key="d" className={f.overdue ? "text-danger" : undefined}>
                      {formatDateTime(f.due_at)}
                      {f.overdue ? " (overdue)" : ""}
                    </span>,
                    f.assignee_name ?? "Unassigned",
                    <Button key="a" size="sm" variant="ghost" onClick={() => askAbout({ leadId: f.lead_id, label: `Lead: ${f.lead_name}` }, "Prepare a follow-up message for this lead")}>
                      <Sparkles className="h-3.5 w-3.5" aria-hidden /> Prepare follow-up
                    </Button>,
                  ])}
                />
              )}
              {tab === "support" && q.urgentSupport && (
                <QueueTable
                  empty="No support cases need escalation."
                  head={["Ticket", "Priority", "Why", "Assignee", ""]}
                  rows={q.urgentSupport.map((t) => [
                    <Link key="n" href={`/admin/support?ticket=${t.id}`} className="font-medium hover:text-primary">
                      {t.ref}
                      <span className="block text-xs font-normal text-muted">{t.subject}</span>
                    </Link>,
                    <PriorityBadge key="p" priority={t.priority} />,
                    t.reason,
                    t.assignee_name ?? <span className="text-danger">Unassigned</span>,
                    <Button key="a" size="sm" variant="ghost" onClick={() => askAbout({ ticketId: t.id, label: `Ticket: ${t.ref}` }, "Summarize this ticket")}>
                      <Sparkles className="h-3.5 w-3.5" aria-hidden /> Ask AI
                    </Button>,
                  ])}
                />
              )}
              {tab === "handoffs" && q.handoffs && (
                <QueueTable
                  empty="No booking requests need action."
                  head={["Trip", "Customer", "Status", "Age", "Owner"]}
                  rows={q.handoffs.map((h) => [
                    <Link key="n" href={`/admin/bookings?handoff=${h.id}`} className="font-medium hover:text-primary">
                      {h.trip_title}
                    </Link>,
                    h.contact_name,
                    <OpsStatusBadge key="s" status={h.ops_status} />,
                    `${h.age_hours}h`,
                    h.assignee_name ?? "Unassigned",
                  ])}
                />
              )}
              {tab === "review" && q.tripsAwaitingReview && (
                <QueueTable
                  empty="No trips are waiting on the customer."
                  head={["Trip", "Customer", "Estimate", "Generated"]}
                  rows={q.tripsAwaitingReview.map((t) => [
                    <Link key="n" href={`/admin/trips?trip=${t.id}`} className="font-medium hover:text-primary">
                      {t.title}
                    </Link>,
                    t.customer ?? "Guest",
                    t.estimated_total ? formatMoney(t.estimated_total) : "—",
                    relativeTime(t.updated_at),
                  ])}
                />
              )}
              {tab === "conversations" && q.activeConversations && (
                <QueueTable
                  empty="No customer conversations in the last 72 hours."
                  head={["Customer", "Channel", "Context", "Messages", "Last message"]}
                  rows={q.activeConversations.map((c) => [
                    <span key="n" className="font-medium">
                      {c.customer}
                    </span>,
                    c.kind === "planner" ? "AI planner" : "Support chat",
                    c.trip_id ? (
                      <Link key="t" href={`/admin/trips?trip=${c.trip_id}`} className="hover:text-primary">
                        {c.trip_title}
                      </Link>
                    ) : (
                      <span key="t" className="line-clamp-1 text-muted">
                        {c.summary ?? "—"}
                      </span>
                    ),
                    c.messages,
                    relativeTime(c.updated_at),
                  ])}
                />
              )}
              {tab === "actions" &&
                (q.recentActions.length ? (
                  <ul className="divide-y divide-border">
                    {q.recentActions.map((a) => (
                      <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                        <ActionStatusIcon status={a.status} />
                        <div className="min-w-0 flex-1">
                          <p>
                            <span className="font-medium">{TOOL_LABEL(a.tool)}</span>{" "}
                            <Badge tone={a.kind === "write" ? "violet" : "neutral"}>{a.kind}</Badge>{" "}
                            <span className="text-xs text-muted">
                              via {a.source === "command_center" ? "Command Center" : a.source === "planner" ? "customer AI planner" : a.source}
                              {a.actorName ? ` · ${a.actorName}` : ""}
                            </span>
                          </p>
                          <p className="text-muted">{a.summary ?? a.error}</p>
                        </div>
                        <span className="whitespace-nowrap text-xs text-muted">{relativeTime(a.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No AI actions yet" />
                ))}
            </div>
          )}
        </Card>

        <Card className="flex h-[calc(100vh-7rem)] min-h-[560px] flex-col overflow-hidden xl:sticky xl:top-20">
          <div className="border-b border-border bg-nav px-5 py-3 text-white">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <RobotAvatar size={24} ring={false} /> AI console
            </p>
            <p className="text-xs text-nav-text">Ask in plain language. Reads run immediately; changes wait for your approval.</p>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {turns.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  Hi {userName.split(" ")[0]} — try one of these{persisted ? ` (your last ${persisted} answers are saved in the conversation history)` : ""}:
                </p>
                <div className="flex flex-col gap-2">
                  {PROMPTS.map((p) => (
                    <button key={p} disabled={busy} onClick={() => ask(p)} className="rounded-md border border-border px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-primary-soft/40">
                      {p}
                    </button>
                  ))}
                  {context && (
                    <>
                      <button disabled={busy} onClick={() => ask("Summarize this customer's requirements and conversation")} className="rounded-md border border-primary/30 bg-primary-soft/40 px-3 py-2 text-left text-sm">
                        Summarize this customer&apos;s requirements and conversation
                      </button>
                      {context.leadId && (
                        <button disabled={busy} onClick={() => ask("Prepare a follow-up message for this lead")} className="rounded-md border border-primary/30 bg-primary-soft/40 px-3 py-2 text-left text-sm">
                          Prepare a follow-up message for this lead
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} className="space-y-2">
                <div className="ml-8 rounded-2xl rounded-tr-md border border-lavender/60 bg-lavender-surface px-3 py-2 text-sm text-foreground">
                  {t.question}
                  {t.context && <span className="mt-0.5 block text-[11px] text-muted">Context: {t.context}</span>}
                </div>
                {!t.response && !t.error && <SkeletonRows rows={3} />}
                {t.error && <Alert tone="red">{t.error}</Alert>}
                {t.response && <ResponseCard r={t.response} decisions={decisions} onDecide={decide} />}
              </div>
            ))}
            <div ref={consoleEnd} />
          </div>
          <form
            className="space-y-2 border-t border-border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const m = input;
              setInput("");
              void ask(m);
            }}
          >
            {ctxLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs text-primary">
                {ctxLabel}
                <button type="button" onClick={() => setContext(null)} aria-label="Remove context" className="rounded-full hover:bg-primary/10">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            <div className="flex gap-2">
              <label htmlFor="command-input" className="sr-only">
                Ask the AI Command Center
              </label>
              <input
                id="command-input"
                value={input}
                maxLength={1500}
                onChange={(e) => setInput(e.target.value)}
                placeholder={ctxLabel ? "Ask about this record…" : "Ask about leads, customers, trips, bookings, support…"}
                className="h-10 flex-1 rounded-md border border-border px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              <Button type="submit" loading={busy} disabled={!input.trim()}>
                <Send className="h-4 w-4" aria-hidden /> Ask
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}

function QueueTable({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 hover:bg-surface-muted/60">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2.5 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
