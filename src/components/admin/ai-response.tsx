"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Check, CircleSlash, ClipboardCopy, Database, Hourglass, Wrench } from "lucide-react";
import { relativeTime, titleCase } from "@/lib/client/format";
import { Alert, Button, Textarea, cn } from "@/components/ui";
import { RichText } from "@/components/rich-text";

/* Shared rendering for answers from the shared AI orchestration layer
   (Command Center console and Employee AI Copilot). */

export const TOOL_LABEL = (t: string) => titleCase(t.replace(/_/g, " "));

export interface RecordRef {
  type: string;
  id: string;
  label: string;
  href?: string;
}
export interface ToolCall {
  actionId: string | null;
  tool: string;
  kind: "read" | "write";
  status: "completed" | "proposed" | "failed";
  summary: string;
  records: RecordRef[];
  description?: string;
  error?: string;
}
export interface AiAction {
  id: string;
  source: string;
  tool: string;
  kind: "read" | "write";
  status: string;
  summary: string | null;
  records: RecordRef[];
  error: string | null;
  actorName?: string | null;
  createdAt: string;
  expiresAt: string | null;
}
export interface CommandResponse {
  conversationId: string;
  answer: string;
  nextSteps: string[];
  draft: string | null;
  toolCalls: ToolCall[];
  records: RecordRef[];
  ai: { planner: string; composer: string; notice: string | null };
}

export function ActionStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-label="Completed" />;
  if (status === "proposed") return <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-label="Awaiting approval" />;
  if (status === "failed") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label="Failed" />;
  return <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-label={status} />;
}

export function ApprovalRow({ action, onDecide }: { action: AiAction; onDecide: (id: string, d: "confirm" | "reject") => Promise<void> }) {
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  const decided = action.status !== "proposed";
  return (
    <li className="space-y-2 px-5 py-4 text-sm">
      <div className="flex items-start gap-3">
        <ActionStatusIcon status={action.status} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{TOOL_LABEL(action.tool)}</p>
          <p className="text-slate-700">{action.summary}</p>
          {action.error && <p className="text-danger">{action.error}</p>}
          <p className="mt-1 text-xs text-muted">
            Requested {relativeTime(action.createdAt)}
            {action.expiresAt && !decided ? ` · expires ${relativeTime(action.expiresAt)}` : ""}
          </p>
        </div>
      </div>
      {!decided ? (
        <div className="flex gap-2 pl-7">
          <Button size="sm" loading={busy === "confirm"} onClick={async () => (setBusy("confirm"), await onDecide(action.id, "confirm"), setBusy(null))}>
            <Check className="h-3.5 w-3.5" aria-hidden /> Approve &amp; run
          </Button>
          <Button size="sm" variant="secondary" loading={busy === "reject"} onClick={async () => (setBusy("reject"), await onDecide(action.id, "reject"), setBusy(null))}>
            Reject
          </Button>
        </div>
      ) : (
        <p className="pl-7 text-xs font-medium capitalize text-muted">{action.status}</p>
      )}
    </li>
  );
}

export function ResponseCard({ r, decisions, onDecide }: { r: CommandResponse; decisions: Record<string, AiAction>; onDecide: (id: string, d: "confirm" | "reject") => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const proposed = r.toolCalls.filter((c) => c.status === "proposed" && c.actionId);
  const completedWrites = r.toolCalls.filter((c) => c.kind === "write" && c.status === "completed");
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-3.5 text-sm shadow-sm">
      {r.ai.notice && <Alert tone="amber">{r.ai.notice}</Alert>}
      <RichText text={r.answer} className="text-slate-800" />
      {r.draft && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-medium text-muted">Draft — review before sending; nothing has been sent</p>
            <button
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(r.draft ?? "");
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <Textarea readOnly value={r.draft} aria-label="Prepared follow-up message" className="min-h-[110px] bg-surface-muted text-sm" />
        </div>
      )}
      {proposed.map((p) => {
        const d = decisions[p.actionId!];
        return (
          <div key={p.actionId} className={cn("rounded-md border p-3", d?.status === "completed" ? "border-accent/40 bg-accent-soft" : d ? "border-border bg-surface-muted" : "border-warning/40 bg-warning-soft")}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{d ? (d.status === "completed" ? "Completed" : d.status === "rejected" ? "Rejected" : "Failed") : "Needs your approval"}</p>
            <p className="mt-1">{d?.status === "completed" ? d.summary : p.description ?? p.summary}</p>
            {d?.error && <p className="mt-1 text-danger">{d.error}</p>}
            {!d && <ApprovalButtons id={p.actionId!} onDecide={onDecide} />}
          </div>
        );
      })}
      {completedWrites.map((c) => (
        <p key={c.actionId} className="rounded-md bg-accent-soft p-2 text-xs">
          <Check className="mr-1 inline h-3.5 w-3.5 text-accent" aria-hidden /> Completed: {c.summary}
        </p>
      ))}
      {r.nextSteps.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Suggested next steps</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
            {r.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {r.records.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-muted">
            <Database className="h-3.5 w-3.5" aria-hidden /> Sources
          </span>
          {r.records.slice(0, 10).map((rec) =>
            rec.href ? (
              <Link key={`${rec.type}-${rec.id}`} href={rec.href} className="rounded-full border border-border bg-surface px-2 py-0.5 hover:border-primary/40 hover:text-primary">
                {rec.label}
              </Link>
            ) : (
              <span key={`${rec.type}-${rec.id}`} className="rounded-full border border-border bg-surface px-2 py-0.5">
                {rec.label}
              </span>
            ),
          )}
          {r.records.length > 10 && <span className="text-muted">+{r.records.length - 10} more</span>}
        </div>
      )}
      <details className="rounded-md bg-surface-muted p-2 text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">
          <Wrench className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          {r.toolCalls.length} tool call{r.toolCalls.length === 1 ? "" : "s"} · planner: {r.ai.planner} · writer: {r.ai.composer}
        </summary>
        <ul className="mt-2 space-y-1">
          {r.toolCalls.map((c, i) => (
            <li key={i} className="flex items-start gap-2">
              <ActionStatusIcon status={c.status} />
              <span>
                <code className="font-mono">{c.tool}</code> <span className="text-muted">({c.kind}, {c.status})</span> — {c.summary}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function ApprovalButtons({ id, onDecide }: { id: string; onDecide: (id: string, d: "confirm" | "reject") => Promise<void> }) {
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  return (
    <div className="mt-2 flex gap-2">
      <Button size="sm" loading={busy === "confirm"} onClick={async () => (setBusy("confirm"), await onDecide(id, "confirm"), setBusy(null))}>
        <Check className="h-3.5 w-3.5" aria-hidden /> Approve &amp; run
      </Button>
      <Button size="sm" variant="secondary" loading={busy === "reject"} onClick={async () => (setBusy("reject"), await onDecide(id, "reject"), setBusy(null))}>
        Reject
      </Button>
    </div>
  );
}
