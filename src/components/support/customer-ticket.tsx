"use client";

import Link from "next/link";
import { useState } from "react";
import { Star } from "lucide-react";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { Alert, Button, Card, CardHeader, ErrorState, SkeletonRows, Textarea, cn } from "@/components/ui";
import { PriorityBadge, TicketStatusBadge } from "@/components/status";

interface TicketDetail {
  ticket: { id: string; ref: string; subject: string; status: string; priority: string; category: string; csat_score: number | null; trip_title: string | null; created_at: string; escalated: number };
  messages: { id: string; author_type: string; author_name: string | null; body: string; created_at: string }[];
}

const AUTHOR: Record<string, string> = { customer: "You", agent: "Travel expert", ai: "Support assistant", system: "Update" };

export function CustomerTicket({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<TicketDetail>(`/api/support/tickets/${id}`);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (loading && !data) return <SkeletonRows rows={6} />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const { ticket, messages } = data;

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/support/tickets/${id}/messages`, { body: { body: reply } });
      setReply("");
      reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    setErr(null);
    try {
      await api(`/api/support/tickets/${id}`, { method: "PATCH", body });
      reload();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/support" className="text-sm text-primary hover:underline">
        ← Back to support
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TicketStatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
        {ticket.escalated ? <span className="text-xs text-danger">Handled by a human agent</span> : null}
      </div>
      <h1 className="mt-2 text-xl font-semibold">
        {ticket.subject} <span className="text-base font-normal text-muted">· {ticket.ref}</span>
      </h1>
      {ticket.trip_title && <p className="text-sm text-muted">Trip: {ticket.trip_title}</p>}
      <Card className="mt-5">
        <CardHeader title="Conversation" />
        <ol className="space-y-4 p-5">
          {messages.map((m) => (
            <li key={m.id} className={cn("rounded-lg p-3 text-sm", m.author_type === "customer" ? "ml-8 bg-primary-soft" : m.author_type === "system" ? "bg-surface-muted text-muted" : "mr-8 border border-border")}>
              <p className="mb-1 text-xs text-muted">
                {m.author_type === "agent" && m.author_name ? `${m.author_name} (travel expert)` : AUTHOR[m.author_type]} · {formatDateTime(m.created_at)}
              </p>
              <p className="whitespace-pre-line">{m.body}</p>
            </li>
          ))}
        </ol>
        {ticket.status !== "closed" && (
          <div className="space-y-2 border-t border-border p-5">
            <label htmlFor="reply" className="text-sm font-medium">
              Add a message
            </label>
            <Textarea id="reply" value={reply} maxLength={4000} onChange={(e) => setReply(e.target.value)} />
            {err && <Alert tone="red">{err}</Alert>}
            <div className="flex flex-wrap justify-between gap-2">
              {ticket.status === "resolved" || ticket.status === "open" ? (
                <Button variant="ghost" onClick={() => patch({ status: "closed" })}>
                  Close ticket
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={send} loading={busy} disabled={!reply.trim()}>
                Send
              </Button>
            </div>
          </div>
        )}
      </Card>
      {(ticket.status === "resolved" || ticket.status === "closed") && (
        <Card className="mt-4 p-5">
          <p className="text-sm font-medium">How satisfied are you with the support you received?</p>
          <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Satisfaction rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} role="radio" aria-checked={ticket.csat_score === n} aria-label={`${n} out of 5`} onClick={() => patch({ csatScore: n })} className="rounded p-1 hover:bg-surface-muted">
                <Star className={cn("h-6 w-6", (ticket.csat_score ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-slate-300")} />
              </button>
            ))}
          </div>
          {ticket.csat_score && <p className="mt-1 text-xs text-muted">Thanks for your feedback!</p>}
        </Card>
      )}
    </div>
  );
}
