"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Bot, Check, Lightbulb, Plus, X } from "lucide-react";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { formatDateTime, formatMoney, formatMonth, relativeTime, useDebounced } from "@/lib/client/format";
import type { Employee } from "@/lib/client/types";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, SkeletonRows, Textarea, cn, DRAWER_CLASS } from "@/components/ui";
import { LeadStageBadge, TripStatusBadge } from "@/components/status";
import { useToast } from "@/components/feedback";

interface Lead {
  id: string;
  trip_id: string | null;
  user_id?: string | null;
  anon_id?: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  destination: string | null;
  travel_month: string | null;
  travellers: number | null;
  budget: number | null;
  currency: string;
  source: string;
  stage: string;
  score: number;
  estimated_value: number | null;
  assigned_to: string | null;
  assignee_name: string | null;
  next_follow_up_at: string | null;
  lost_reason: string | null;
  trip_status: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}
interface LeadDetailData {
  lead: Lead;
  allowedTransitions: string[];
  preferences: { summary: string | null } | null;
  itinerary: { id: string; version: number; total: number; days: number; summary: string } | null;
  activities: { id: string; type: string; body: string; actor_name: string | null; created_at: string }[];
  followUps: { id: string; due_at: string; channel: string; note: string | null; status: string }[];
  conversation: string | null;
  nextAction: { action: string; reason: string; urgency: "high" | "medium" | "low" };
}

const STAGES = ["new", "contacted", "qualified", "proposal_sent", "won", "lost"];
const STAGE_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", proposal_sent: "Proposal sent", won: "Won", lost: "Lost" };

export function LeadsCRM({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("lead");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [assignee, setAssignee] = useState("");
  const [sort, setSort] = useState(params.get("sort") ?? "created_desc");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q);
  const qs = new URLSearchParams({ page: String(page), pageSize: "15", sort, ...(dq && { q: dq }), ...(stage && { stage }), ...(assignee && { assignedTo: assignee }) });
  const list = useApi<{ items: Lead[]; total: number; page: number; pageSize: number }>(`/api/leads?${qs}`);
  const users = useApi<{ items: Employee[] }>("/api/users");
  const reps = (users.data?.items ?? []).filter((u) => u.role === "sales" || u.role === "admin");

  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("lead", id);
    else next.delete("lead");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="Leads & sales CRM"
        description="Leads are created automatically from AI trip-planning sessions, and can be added manually. Values are itinerary estimates, not confirmed revenue."
        actions={
          canWrite && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New lead
            </Button>
          )
        }
      />
      <div className={cn("grid gap-6", selected && "2xl:grid-cols-[1fr_440px]")}>
        <Card className="min-w-0">
          <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input type="search" aria-label="Search leads" placeholder="Search name, email, destination" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
            <Select aria-label="Filter by stage" value={stage} onChange={(e) => (setStage(e.target.value), setPage(1))}>
              <option value="">All stages</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by assignee" value={assignee} onChange={(e) => (setAssignee(e.target.value), setPage(1))}>
              <option value="">Everyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="created_desc">Newest first</option>
              <option value="score_desc">Highest score</option>
              <option value="follow_up_asc">Follow-up due soonest</option>
              <option value="value_desc">Highest value</option>
            </Select>
          </div>
          {list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : list.loading && !list.data ? (
            <SkeletonRows rows={8} />
          ) : !list.data?.items.length ? (
            <EmptyState title="No leads match" description="Try a different search or filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/50 text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Lead</th>
                    <th className="px-4 py-2 font-medium">Trip</th>
                    <th className="px-4 py-2 font-medium">Budget</th>
                    <th className="px-4 py-2 font-medium">Stage</th>
                    <th className="px-4 py-2 font-medium">Score</th>
                    <th className="px-4 py-2 font-medium">Owner</th>
                    <th className="px-4 py-2 font-medium">Follow-up</th>
                    <th className="px-4 py-2 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((l) => (
                    <tr
                      key={l.id}
                      onClick={() => select(l.id)}
                      className={cn("cursor-pointer border-b border-border/60 hover:bg-surface-muted", selected === l.id && "bg-primary-soft/60")}
                    >
                      <td className="px-4 py-2.5">
                        <button className="text-left font-medium hover:text-primary" onClick={() => select(l.id)}>
                          {l.name}
                        </button>
                        <p className="text-xs text-muted">
                          {l.email ?? "No email"} · {l.source === "ai_planner" ? "AI planner" : l.source}
                          {l.is_demo ? " · demo" : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p>{l.destination ?? "—"}</p>
                        <p className="text-xs text-muted">
                          {l.travel_month ? formatMonth(l.travel_month) : "No dates"} {l.travellers ? `· ${l.travellers} pax` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="tabular-nums">{l.budget ? formatMoney(l.budget) : "—"}</p>
                        {l.estimated_value ? <p className="text-xs text-muted">est. {formatMoney(l.estimated_value)}</p> : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <LeadStageBadge stage={l.stage} />
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{l.score}</td>
                      <td className="px-4 py-2.5">{l.assignee_name ?? <span className="text-muted">Unassigned</span>}</td>
                      <td className={cn("px-4 py-2.5 text-xs", l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date() ? "text-danger" : "text-muted")}>
                        {l.next_follow_up_at ? relativeTime(l.next_follow_up_at) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">{relativeTime(l.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
        </Card>
        {selected && <LeadDetail id={selected} reps={reps} canWrite={canWrite} onClose={() => select(null)} onChanged={list.reload} />}
      </div>
      {creating && (
        <NewLeadModal
          reps={reps}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            list.reload();
            select(id);
          }}
        />
      )}
    </>
  );
}

function LeadDetail({ id, reps, canWrite, onClose, onChanged }: { id: string; reps: Employee[]; canWrite: boolean; onClose: () => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi<LeadDetailData>(`/api/leads/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [fu, setFu] = useState({ dueAt: "", channel: "call", note: "" });
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
  const patch = (body: Record<string, unknown>, key: string, done?: string) => run(key, () => api(`/api/leads/${id}`, { method: "PATCH", body }), done);

  return (
    <Card className={DRAWER_CLASS}>
      <CardHeader
        title={data?.lead.name ?? "Lead"}
        description={data ? `${data.lead.email ?? "No email"}${data.lead.phone ? ` · ${data.lead.phone}` : ""}` : undefined}
        action={
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-muted" aria-label="Close lead details">
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
          <div className="flex flex-wrap items-center gap-2">
            <LeadStageBadge stage={data.lead.stage} />
            <Badge tone="neutral">Score {data.lead.score}/100</Badge>
            {data.lead.trip_status && <TripStatusBadge status={data.lead.trip_status} />}
            {data.lead.is_demo ? <Badge tone="amber">Demo record</Badge> : null}
          </div>
          {err && <Alert tone="red">{err}</Alert>}

          <section className={cn("rounded-lg border p-3", data.nextAction.urgency === "high" ? "border-warning/40 bg-warning-soft" : "border-accent/30 bg-accent-soft/60")}>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <Lightbulb className="h-3.5 w-3.5 text-accent" aria-hidden /> Suggested next action
            </p>
            <p className="mt-1 font-medium">{data.nextAction.action}</p>
            <p className="text-xs text-muted">{data.nextAction.reason} Rule-based from stage, follow-ups and trip status.</p>
          </section>

          <section className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-surface-muted/70 px-2.5 py-2">
              <p className="text-muted">Trip dates</p>
              <p className="mt-0.5 font-medium">{data.lead.travel_month ? formatMonth(data.lead.travel_month) : "Not set"}</p>
            </div>
            <div className="rounded-lg bg-surface-muted/70 px-2.5 py-2">
              <p className="text-muted">Budget</p>
              <p className="mt-0.5 font-medium">{data.lead.budget ? formatMoney(data.lead.budget) : "Not set"}</p>
            </div>
            <div className="rounded-lg bg-surface-muted/70 px-2.5 py-2">
              <p className="text-muted">Est. value</p>
              <p className="mt-0.5 font-medium">{data.lead.estimated_value ? formatMoney(data.lead.estimated_value) : "—"}</p>
            </div>
          </section>

          {data.conversation && data.conversation !== data.preferences?.summary && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Planner conversation summary</h3>
              <p className="text-slate-700">{data.conversation}</p>
            </section>
          )}

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Customer preferences</h3>
            <p className="text-slate-700">{data.preferences?.summary || "No structured preferences (manual lead)."}</p>
            {data.itinerary && (
              <p className="mt-2 text-slate-700">
                Itinerary v{data.itinerary.version}: {data.itinerary.days} days, est. {formatMoney(data.itinerary.total)}.{" "}
                {data.lead.trip_id && (
                  <Link href={`/admin/trips?trip=${data.lead.trip_id}`} className="text-primary hover:underline">
                    View
                  </Link>
                )}
              </p>
            )}
            {data.lead.lost_reason && <p className="mt-1 text-danger">Lost: {data.lead.lost_reason}</p>}
            {(data.lead.user_id || data.lead.anon_id) && (
              <Link
                href={`/admin/customers?customer=${encodeURIComponent(data.lead.user_id ? `user:${data.lead.user_id}` : `guest:${data.lead.anon_id}`)}`}
                className="mt-2 inline-block text-primary hover:underline"
              >
                Open customer record →
              </Link>
            )}
          </section>

          {canWrite && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Sales stage</h3>
              <div className="flex flex-wrap gap-2">
                {data.allowedTransitions.length === 0 && <span className="text-muted">Closed lead.</span>}
                {data.allowedTransitions.map((s) => (
                  <Button key={s} size="sm" variant={s === "lost" ? "danger" : "secondary"} loading={busy === s} onClick={() => (s === "lost" ? setLostOpen(true) : patch({ stage: s }, s, `Moved to ${STAGE_LABEL[s]}`))}>
                    Move to {STAGE_LABEL[s]}
                  </Button>
                ))}
              </div>
              <Field label="Owner" htmlFor="lead-owner">
                <Select id="lead-owner" value={data.lead.assigned_to ?? ""} onChange={(e) => patch({ assignedTo: e.target.value || null }, "assign", "Owner updated")}>
                  <option value="">Unassigned</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Follow-ups</h3>
            {data.followUps.length === 0 && <p className="text-muted">None scheduled.</p>}
            <ul className="space-y-1.5">
              {data.followUps.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <span className={cn(f.status !== "pending" && "text-muted line-through")}>
                    {f.channel} · {formatDateTime(f.due_at)}
                    {f.note && <span className="block text-xs text-muted">{f.note}</span>}
                  </span>
                  {canWrite && f.status === "pending" && (
                    <Button size="sm" variant="ghost" loading={busy === f.id} onClick={() => run(f.id, () => api(`/api/leads/${id}/follow-ups/${f.id}`, { method: "PATCH", body: { status: "done" } }), "Follow-up marked done")} aria-label="Mark follow-up done">
                      <Check className="h-4 w-4" /> Done
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canWrite && (
              <form
                className="grid gap-2 sm:grid-cols-[1fr_110px_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!fu.dueAt) return;
                  void run("fu", () => api(`/api/leads/${id}/follow-ups`, { body: { dueAt: new Date(fu.dueAt).toISOString(), channel: fu.channel, note: fu.note || null } }), "Follow-up scheduled").then(() =>
                    setFu({ dueAt: "", channel: "call", note: "" }),
                  );
                }}
              >
                <Input type="datetime-local" aria-label="Follow-up date and time" required value={fu.dueAt} onChange={(e) => setFu({ ...fu, dueAt: e.target.value })} />
                <Select aria-label="Channel" value={fu.channel} onChange={(e) => setFu({ ...fu, channel: e.target.value })}>
                  <option value="call">Call</option>
                  <option value="email">Email</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="meeting">Meeting</option>
                </Select>
                <Button type="submit" size="md" variant="secondary" loading={busy === "fu"}>
                  Schedule
                </Button>
              </form>
            )}
          </section>

          {canWrite && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Add a note</h3>
              <Textarea aria-label="Note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="Call summary, customer questions…" />
              <div className="flex justify-between">
                <Link href={`/admin/copilot?leadId=${id}&label=${encodeURIComponent(`Lead: ${data.lead.name}`)}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                  <Bot className="h-4 w-4" aria-hidden /> Ask the AI Copilot
                </Link>
                <Button size="sm" disabled={!note.trim()} loading={busy === "note"} onClick={() => patch({ note }, "note", "Note saved").then(() => setNote(""))}>
                  Save note
                </Button>
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Activity</h3>
            <ol className="space-y-3 border-l border-border pl-4">
              {data.activities.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />
                  <p className="text-slate-700">{a.body}</p>
                  <p className="text-xs text-muted">
                    {a.actor_name ?? "System"} · {formatDateTime(a.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
      <Modal open={lostOpen} onClose={() => setLostOpen(false)} title="Mark lead as lost">
        <Field label="Reason" htmlFor="lost-reason">
          <Select id="lost-reason" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
            <option value="">Choose a reason…</option>
            {["No response", "Budget too low", "Booked elsewhere", "Postponed trip", "Not a real enquiry"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setLostOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!lostReason} loading={busy === "lost"} onClick={() => patch({ stage: "lost", lostReason }, "lost", "Lead marked as lost").then(() => setLostOpen(false))}>
            Mark as lost
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function NewLeadModal({ reps, onClose, onCreated }: { reps: Employee[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", destination: "", travelMonth: "", travellers: "", budget: "", assignedTo: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="New lead" wide>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const res = await api<{ lead: { id: string } }>("/api/leads", {
              body: {
                name: f.name,
                email: f.email || null,
                phone: f.phone || null,
                destination: f.destination || null,
                travelMonth: f.travelMonth || null,
                travellers: f.travellers ? Number(f.travellers) : null,
                budget: f.budget ? Number(f.budget) : null,
                assignedTo: f.assignedTo || null,
                note: f.note || null,
              },
            });
            onCreated(res.lead.id);
          } catch (e2) {
            setErr(errorMessage(e2));
            setBusy(false);
          }
        }}
      >
        <Field label="Name" htmlFor="nl-name">
          <Input id="nl-name" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email" htmlFor="nl-email">
          <Input id="nl-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Phone" htmlFor="nl-phone">
          <Input id="nl-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Destination" htmlFor="nl-dest">
          <Input id="nl-dest" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} />
        </Field>
        <Field label="Travel month" htmlFor="nl-month">
          <Input id="nl-month" type="month" value={f.travelMonth} onChange={(e) => setF({ ...f, travelMonth: e.target.value })} />
        </Field>
        <Field label="Travellers" htmlFor="nl-pax">
          <Input id="nl-pax" type="number" min={1} max={40} value={f.travellers} onChange={(e) => setF({ ...f, travellers: e.target.value })} />
        </Field>
        <Field label="Budget (INR)" htmlFor="nl-budget">
          <Input id="nl-budget" type="number" min={0} value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />
        </Field>
        <Field label="Owner" htmlFor="nl-owner">
          <Select id="nl-owner" value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })}>
            <option value="">Unassigned</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note" htmlFor="nl-note">
            <Textarea id="nl-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
        {err && (
          <Alert tone="red" className="sm:col-span-2">
            {err}
          </Alert>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create lead
          </Button>
        </div>
      </form>
    </Modal>
  );
}
