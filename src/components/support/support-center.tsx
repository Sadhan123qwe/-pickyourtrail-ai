"use client";

import { RobotAvatar } from "@/components/robot";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BookOpen, CalendarClock, CreditCard, FileText, LifeBuoy, RefreshCcw, Send, Siren, TriangleAlert } from "lucide-react";
import { api, errorMessage, newClientId, useApi } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/format";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, SkeletonRows, Textarea, cn } from "@/components/ui";
import { AiSourceBadge, PriorityBadge, TicketStatusBadge } from "@/components/status";
import { RichText } from "@/components/rich-text";

interface Msg {
  id: string;
  role: string;
  content: string;
  meta?: { sources?: { id: string; title: string; isDemo: boolean }[]; offerTicket?: boolean; ticket?: { id: string; ref: string } | null; aiSource?: string } | null;
  failed?: boolean;
}
interface Ticket {
  id: string;
  ref: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  updated_at: string;
  escalated: number;
}
interface Faq {
  id: string;
  title: string;
  category: string;
  body: string;
  isDemo: boolean;
}
interface TripOpt {
  id: string;
  title: string;
}

export function SupportCenter() {
  const conv = useApi<{ conversationId: string | null; messages: Msg[] }>("/api/support/conversation");
  const tickets = useApi<{ items: Ticket[] }>("/api/support/tickets");
  const faq = useApi<{ items: Faq[] }>("/api/support/faq");
  const trips = useApi<{ items: TripOpt[] }>("/api/trips");
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [tripId, setTripId] = useState("");
  const [faqQuery, setFaqQuery] = useState("");
  const [faqCategory, setFaqCategory] = useState<string | null>(null);
  const [ticketOpen, setTicketOpen] = useState<{ subject: string; message: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: "green" | "red" | "amber"; text: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const shown = messages ?? conv.data?.messages ?? [];
  const activeConversation = conversationId ?? conv.data?.conversationId ?? null;
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [shown.length]);

  async function ask(text: string) {
    const message = text.trim();
    if (!message) return;
    const clientId = newClientId("s");
    const base = shown;
    setMessages([...base, { id: clientId, role: "user", content: message }]);
    setSending(true);
    try {
      const res = await api<{ conversationId: string; reply: string; sources: { id: string; title: string; isDemo: boolean }[]; offerTicket: boolean; ticket: { id: string; ref: string } | null; ai: { source: string; notice: string | null } }>(
        "/api/ai/chat",
        { body: { mode: "support", message, conversationId: activeConversation ?? undefined, tripId: tripId || undefined, clientMessageId: clientId } },
      );
      setConversationId(res.conversationId);
      setMessages([...base, { id: clientId, role: "user", content: message }, { id: newClientId("r"), role: "assistant", content: res.reply, meta: { sources: res.sources, offerTicket: res.offerTicket, ticket: res.ticket, aiSource: res.ai.source } }]);
      if (res.ticket) tickets.reload();
      if (res.ai.notice) setNotice({ tone: "amber", text: res.ai.notice });
    } catch (e) {
      setMessages([...base, { id: clientId, role: "user", content: message, failed: true }]);
      setNotice({ tone: "red", text: errorMessage(e) });
    } finally {
      setSending(false);
    }
  }

  const lastUser = [...shown].reverse().find((m) => m.role === "user");

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      <PageHeader
        title="Help & support"
        description="Answers come from approved help articles and your own trip records. Anything policy-sensitive or urgent goes to a human travel expert."
        actions={
          <Button onClick={() => setTicketOpen({ subject: "", message: "" })}>
            <LifeBuoy className="h-4 w-4" aria-hidden /> Create a ticket
          </Button>
        }
      />

      <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { icon: CalendarClock, label: "Change my trip", q: "Can I change my travel dates?" },
          { icon: RefreshCcw, label: "Cancellations & refunds", q: "What is your cancellation policy?" },
          { icon: CreditCard, label: "Payments", q: "Can I pay in EMI?" },
          { icon: FileText, label: "Visa & documents", q: "What documents do I need for my visa?" },
          { icon: Siren, label: "Urgent travel problem", q: null },
        ].map((c) => (
          <button
            key={c.label}
            onClick={() => (c.q ? ask(c.q) : setTicketOpen({ subject: "Urgent travel problem", message: "" }))}
            disabled={sending}
            className={cn("surface flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-left text-[13px] font-medium transition-colors hover:border-primary/40", !c.q && "border-danger/30 text-danger")}
          >
            <c.icon className="h-4 w-4 shrink-0" aria-hidden /> {c.label}
          </button>
        ))}
      </div>

      <Alert tone="red" className="mb-5" title="Urgent travel problem?">
        If you&apos;re stranded, have missed a flight, lost documents or need medical help, describe it in the chat or create a ticket — urgent issues go straight to a human agent. If anyone is in danger, contact local emergency services first.
      </Alert>

      {notice && (
        <Alert tone={notice.tone} className="mb-4">
          {notice.text}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="flex h-[600px] flex-col overflow-hidden">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <RobotAvatar size={24} ring={false} /> Support assistant
              </span>
            }
            description="Answers come from our help articles (demo content). It never confirms refunds or bookings."
          />
          <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
            {conv.loading && !conv.data && <SkeletonRows rows={3} />}
            {conv.error && <ErrorState error={conv.error} onRetry={conv.reload} compact />}
            {shown.length === 0 && !conv.loading && (
              <div className="text-sm text-muted">
                <p>Hi! Ask me about cancellations, payments, visas, changes to your trip, or the status of your booking request.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["What is your cancellation policy?", "What's the status of my booking?", "Do I need a visa for Bali?", "Can I pay in EMI?"].map((s) => (
                    <button key={s} onClick={() => ask(s)} className="rounded-full border border-border px-3 py-1 text-sm text-foreground hover:bg-surface-muted">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {shown.map((m) => (
              <div key={m.id} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && <RobotAvatar size={28} className="mt-0.5" />}
                <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", m.role === "user" ? "rounded-tr-md border border-lavender/60 bg-lavender-surface text-foreground" : "rounded-tl-md border border-border bg-surface", m.failed && "ring-2 ring-tomato/60")}>
                  <RichText text={m.content} />
                  {m.meta?.sources && m.meta.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <BookOpen className="h-3.5 w-3.5 text-muted" aria-hidden />
                      {m.meta.sources.map((s) => (
                        <Badge key={s.id} tone="neutral" title="Demonstration content, not an official policy">
                          {s.title}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {m.meta?.aiSource && m.role === "assistant" && (
                    <div className="mt-2">
                      <AiSourceBadge source={m.meta.aiSource} />
                    </div>
                  )}
                  {m.meta?.ticket && (
                    <Link href={`/support/tickets/${m.meta.ticket.id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-danger underline">
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> View ticket {m.meta.ticket.ref}
                    </Link>
                  )}
                  {m.meta?.offerTicket && !m.meta.ticket && (
                    <Button size="sm" variant="secondary" className="mt-2" onClick={() => setTicketOpen({ subject: lastUser?.content.slice(0, 80) ?? "", message: lastUser?.content ?? "" })}>
                      Create a ticket for a human agent
                    </Button>
                  )}
                  {m.failed && (
                    <button className="mt-1 block text-xs underline" onClick={() => ask(m.content)}>
                      Not sent — retry
                    </button>
                  )}
                </div>
              </div>
            ))}
            {sending && <p className="text-sm text-muted">Looking that up…</p>}
          </div>
          <div className="space-y-2 border-t border-border p-4">
            {trips.data && trips.data.items.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="support-trip" className="text-xs text-muted">
                  About trip
                </label>
                <Select id="support-trip" className="h-8 max-w-xs text-xs" value={tripId} onChange={(e) => setTripId(e.target.value)}>
                  <option value="">General question</option>
                  {trips.data.items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = input;
                setInput("");
                void ask(t);
              }}
            >
              <label htmlFor="support-input" className="sr-only">
                Your question
              </label>
              <Input id="support-input" value={input} maxLength={1500} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" />
              <Button type="submit" disabled={!input.trim() || sending}>
                <Send className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Send</span>
              </Button>
            </form>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="My tickets" />
            {tickets.loading && !tickets.data ? (
              <SkeletonRows rows={3} />
            ) : tickets.error ? (
              <ErrorState error={tickets.error} onRetry={tickets.reload} compact />
            ) : !tickets.data?.items.length ? (
              <EmptyState title="No tickets yet" description="Tickets you create will appear here with their status." />
            ) : (
              <ul className="divide-y divide-border">
                {tickets.data.items.map((t) => (
                  <li key={t.id}>
                    <Link href={`/support/tickets/${t.id}`} className="block px-5 py-3 hover:bg-surface-muted">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{t.subject}</p>
                        <TicketStatusBadge status={t.status} />
                      </div>
                      <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                        {t.ref} · <PriorityBadge priority={t.priority} /> · updated {relativeTime(t.updated_at)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Frequently asked" description="Demonstration content — not official Pickyourtrail policies." />
            <div className="space-y-2 border-b border-border/70 p-3">
              <Input type="search" aria-label="Search help articles" placeholder="Search help articles" value={faqQuery} onChange={(e) => setFaqQuery(e.target.value)} />
              <div className="flex flex-wrap gap-1.5">
                {Array.from(new Set((faq.data?.items ?? []).map((f) => f.category))).map((c) => (
                  <button
                    key={c}
                    aria-pressed={faqCategory === c}
                    onClick={() => setFaqCategory(faqCategory === c ? null : c)}
                    className={cn("rounded-full border px-2.5 py-0.5 text-xs", faqCategory === c ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-muted")}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            {faq.loading && !faq.data ? (
              <SkeletonRows rows={4} />
            ) : faq.error ? (
              <ErrorState error={faq.error} onRetry={faq.reload} compact />
            ) : (
              <div className="divide-y divide-border">
                {(faq.data?.items ?? []).filter((f) => (!faqCategory || f.category === faqCategory) && (!faqQuery.trim() || `${f.title} ${f.body}`.toLowerCase().includes(faqQuery.trim().toLowerCase()))).length === 0 && (
                  <p className="px-4 py-6 text-center text-[13px] text-muted">No articles match. Ask the assistant or create a ticket.</p>
                )}
                {(faq.data?.items ?? []).filter((f) => (!faqCategory || f.category === faqCategory) && (!faqQuery.trim() || `${f.title} ${f.body}`.toLowerCase().includes(faqQuery.trim().toLowerCase()))).map((f) => (
                  <details key={f.id} className="group px-5 py-3">
                    <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
                      <span className="flex items-center justify-between gap-2">
                        {f.title}
                        <span className="text-muted transition-transform group-open:rotate-45" aria-hidden>
                          +
                        </span>
                      </span>
                    </summary>
                    <div className="mt-2 whitespace-pre-line text-sm text-muted">{f.body}</div>
                  </details>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {ticketOpen && (
        <NewTicketModal
          initial={ticketOpen}
          trips={trips.data?.items ?? []}
          defaultTripId={tripId}
          conversationId={activeConversation}
          onClose={() => setTicketOpen(null)}
          onCreated={(t) => {
            setTicketOpen(null);
            setNotice({ tone: "green", text: `Ticket ${t.ref} created${t.escalated ? " and escalated to a human agent" : ""}. We'll reply here and by email.` });
            tickets.reload();
          }}
        />
      )}
    </div>
  );
}

function NewTicketModal({
  initial,
  trips,
  defaultTripId,
  conversationId,
  onClose,
  onCreated,
}: {
  initial: { subject: string; message: string };
  trips: TripOpt[];
  defaultTripId: string;
  conversationId: string | null;
  onClose: () => void;
  onCreated: (t: Ticket) => void;
}) {
  const [form, setForm] = useState({ ...initial, tripId: defaultTripId, email: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => newClientId("ticket"));
  return (
    <Modal open onClose={onClose} title="Create a support ticket">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const res = await api<{ ticket: Ticket }>("/api/support/tickets", {
              body: { subject: form.subject || null, message: form.message, tripId: form.tripId || null, conversationId, contactEmail: form.email || null, idempotencyKey: key },
            });
            onCreated(res.ticket);
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Subject" htmlFor="t-subject">
          <Input id="t-subject" maxLength={160} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </Field>
        <Field label="How can we help?" htmlFor="t-message">
          <Textarea id="t-message" required minLength={5} maxLength={4000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        </Field>
        {trips.length > 0 && (
          <Field label="Related trip (optional)" htmlFor="t-trip">
            <Select id="t-trip" value={form.tripId} onChange={(e) => setForm({ ...form, tripId: e.target.value })}>
              <option value="">None</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Contact email (optional if signed in)" htmlFor="t-email">
          <Input id="t-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <p className="text-xs text-muted">Priority and category are set automatically; urgent travel problems are escalated immediately.</p>
        {error && <Alert tone="red">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create ticket
          </Button>
        </div>
      </form>
    </Modal>
  );
}
