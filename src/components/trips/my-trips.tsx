"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays, Clock, Copy, LayoutGrid, List, Luggage, Pencil, Plus, Sparkles, Users, Wallet, XCircle } from "lucide-react";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { formatDate, formatMoney, formatMonth, relativeTime } from "@/lib/client/format";
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Segmented, Skeleton, Tabs } from "@/components/ui";
import { useConfirm, useToast } from "@/components/feedback";
import { lifecycleStage } from "@/components/status";
import { OpsStatusBadge, ProviderStatusBadge, TripStatusBadge } from "@/components/status";
import { DestinationImage } from "@/components/destination-image";

interface TripItem {
  id: string;
  title: string;
  status: string;
  destination_id: string | null;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
  travel_month: string | null;
  duration_days: number | null;
  travellers: number | null;
  estimated_total: number | null;
  itinerary_id: string | null;
  handoff_status: string | null;
  provider_status: string | null;
  updated_at: string;
}

const imageFor = (id: string | null) => (id ? `/images/destinations/${id}.jpg` : null);

type Tab = "upcoming" | "saved" | "completed" | "drafts" | "all";

function classify(t: TripItem): Exclude<Tab, "all">[] {
  const today = new Date().toISOString().slice(0, 10);
  if (t.status === "completed" || (t.end_date && t.end_date < today && t.status !== "cancelled")) return ["completed"];
  const tabs: Exclude<Tab, "all">[] = [];
  if (t.status === "planning" || t.status === "itinerary_ready") tabs.push("drafts");
  if (t.status === "saved" || t.status === "handoff_requested" || t.status === "booked") tabs.push("saved");
  if ((t.status === "handoff_requested" || t.status === "booked" || t.status === "saved") && (t.start_date ?? `${t.travel_month ?? "0000-00"}-31`) >= today) tabs.push("upcoming");
  return tabs;
}

export function MyTrips({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ items: TripItem[] }>("/api/trips");
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [view, setView] = useState<"cards" | "list">("cards");
  const tickets = useApi<{ items: { id: string; ref: string; trip_id: string | null; status: string }[] }>("/api/support/tickets");
  const ticketsByTrip = new Map<string, { id: string; ref: string; status: string }[]>();
  for (const t of tickets.data?.items ?? []) if (t.trip_id) ticketsByTrip.set(t.trip_id, [...(ticketsByTrip.get(t.trip_id) ?? []), t]);

  const items = data?.items ?? [];
  const counts = { upcoming: 0, saved: 0, completed: 0, drafts: 0 };
  for (const t of items) for (const c of classify(t)) counts[c]++;
  const needle = q.trim().toLowerCase();
  const visible = (tab === "all" ? items : items.filter((t) => classify(t).includes(tab))).filter(
    (t) => !needle || `${t.title} ${t.destination_name ?? ""}`.toLowerCase().includes(needle),
  );

  async function duplicate(id: string) {
    setBusy(id);
    try {
      const res = await api<{ trip: { id: string } }>(`/api/trips/${id}/duplicate`, { method: "POST" });
      router.push(`/plan?trip=${res.trip.id}`);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't duplicate the trip", description: errorMessage(e) });
      setBusy(null);
    }
  }

  async function cancel(id: string) {
    if (!(await confirm({ title: "Cancel this trip?", description: "Any open booking request will be withdrawn from the expert queue. You can duplicate the trip later to plan again.", confirmLabel: "Cancel trip", cancelLabel: "Keep trip", tone: "danger" }))) return;
    setBusy(id);
    try {
      await api(`/api/trips/${id}`, { method: "PATCH", body: { status: "cancelled" } });
      toast({ tone: "success", title: "Trip cancelled" });
      reload();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't cancel the trip", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      <PageHeader
        title="My Trips"
        description={signedIn ? "Trips saved to your account." : "Trips planned in this browser. Sign in to keep them across devices."}
        actions={
          <>
            <Input type="search" aria-label="Search trips" placeholder="Search trips" value={q} onChange={(e) => setQ(e.target.value)} className="w-52" />
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: "cards", label: "Cards" },
                { value: "list", label: "List" },
              ]}
            />
            <Link href="/plan?new=1" className="inline-flex h-9 items-center gap-2 rounded-xl bg-ai px-3.5 text-sm font-semibold text-nav-deep hover:bg-ai-hover">
              <Plus className="h-4 w-4" aria-hidden /> Plan a new trip
            </Link>
          </>
        }
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: "All", count: items.length },
          { value: "upcoming", label: "Upcoming", count: counts.upcoming },
          { value: "drafts", label: "Planning in progress", count: counts.drafts },
          { value: "saved", label: "Saved itineraries", count: counts.saved },
          { value: "completed", label: "Completed", count: counts.completed },
        ]}
      />
      {loading && !data ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Luggage className="h-6 w-6" />}
            title={tab === "all" ? "No trips yet" : "No trips in this view"}
            description="Start planning and your trips will appear here automatically."
            action={
              <Link href="/plan" className="text-sm font-medium text-primary hover:underline">
                Plan a trip with AI
              </Link>
            }
          />
        </Card>
      ) : view === "list" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-lavender-surface/50 text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Trip</th>
                  <th className="px-4 py-2 font-medium">Dates</th>
                  <th className="px-4 py-2 font-medium">Travellers</th>
                  <th className="px-4 py-2 font-medium">Estimate</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                  <th className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t, i) => (
                  <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-lavender-surface/30">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <DestinationImage src={imageFor(t.destination_id)} alt={t.destination_name ?? "Trip"} seed={i} className="h-10 w-14 shrink-0 rounded-lg" card />
                        <span className="font-medium">{t.title}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{dates(t)}</td>
                    <td className="px-4 py-2.5 text-muted">{t.travellers ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{t.estimated_total ? formatMoney(t.estimated_total) : "—"}</td>
                    <td className="px-4 py-2.5">
                      <TripStatusBadge status={t.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{relativeTime(t.updated_at)}</td>
                    <td className="px-4 py-2.5">
                      <TripActions t={t} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((t, i) => (
            <Card key={t.id} className="flex flex-col overflow-hidden">
              <div className="relative aspect-[16/7]">
                <DestinationImage src={imageFor(t.destination_id)} alt={t.destination_name ?? "Trip"} seed={i} className="absolute inset-0" card />
                <div className="absolute inset-0 bg-gradient-to-t from-nav-deep/70 via-transparent to-transparent" aria-hidden />
                <span className="absolute left-3 top-3">
                  <TripStatusBadge status={t.status} />
                </span>
                <h2 className="absolute inset-x-3 bottom-2.5 truncate text-[15px] font-semibold text-white">{t.title}</h2>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                  <div className="col-span-2 flex items-center gap-1.5 text-muted">
                    <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
                    <dt className="sr-only">Dates</dt>
                    <dd>{dates(t)}</dd>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted">
                    <Users className="h-4 w-4 shrink-0" aria-hidden />
                    <dt className="sr-only">Travellers</dt>
                    <dd>{t.travellers ? `${t.travellers} traveller${t.travellers > 1 ? "s" : ""}` : "Travellers TBD"}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Wallet className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                    <dt className="sr-only">Estimated budget</dt>
                    <dd className="tabular-nums">{t.estimated_total ? `${formatMoney(t.estimated_total)} est.` : "No estimate yet"}</dd>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5 text-xs text-muted">
                    <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <dt className="sr-only">Last updated</dt>
                    <dd>Updated {relativeTime(t.updated_at)}</dd>
                  </div>
                </dl>
                <p className="mt-2.5 rounded-lg bg-lavender-surface/70 px-2.5 py-1.5 text-xs font-medium text-foreground">
                  {lifecycleStage({ hasItinerary: !!t.itinerary_id, opsStatus: t.handoff_status, providerStatus: t.provider_status }).label}
                </p>
                {t.handoff_status && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <OpsStatusBadge status={t.handoff_status} />
                    <ProviderStatusBadge status={t.provider_status ?? "not_submitted"} />
                  </div>
                )}
                {(ticketsByTrip.get(t.id) ?? []).map((tk) => (
                  <Link key={tk.id} href={`/support/tickets/${tk.id}`} className="mt-1.5 block text-xs text-primary hover:underline">
                    Support case {tk.ref} · {tk.status.replace(/_/g, " ")}
                  </Link>
                ))}
                <div className="mt-auto pt-4">
                  <TripActions t={t} />
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" loading={busy === t.id} onClick={() => duplicate(t.id)} aria-label={`Duplicate ${t.title}`}>
                      <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicate
                    </Button>
                    {t.status !== "cancelled" && t.status !== "booked" && (
                      <Button variant="ghost" size="sm" className="text-danger" disabled={busy === t.id} onClick={() => cancel(t.id)} aria-label={`Cancel ${t.title}`}>
                        <XCircle className="h-3.5 w-3.5" aria-hidden /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function dates(t: TripItem) {
  const base = t.start_date && t.end_date ? `${formatDate(t.start_date)} – ${formatDate(t.end_date)}` : t.travel_month ? formatMonth(t.travel_month) : "Dates not set";
  return `${base}${t.duration_days ? ` · ${t.duration_days} days` : ""}`;
}

/** Primary trip actions: continue planning, edit itinerary, view details (review & booking status). */
function TripActions({ t, compact }: { t: TripItem; compact?: boolean }) {
  const editable = t.status !== "cancelled" && t.status !== "handoff_requested" && t.status !== "booked";
  const cls = "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-medium";
  return (
    <div className={compact ? "flex justify-end gap-1.5" : "flex flex-wrap gap-2"}>
      {editable && (
        <Link href={`/plan?trip=${t.id}`} className={`${cls} ${t.itinerary_id ? "border border-border hover:bg-surface-muted" : "bg-ai font-semibold text-nav-deep hover:bg-ai-hover"}`}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Continue planning
        </Link>
      )}
      {t.itinerary_id && (
        <Link href={`/trips/${t.id}/itinerary`} className={`${cls} bg-nav-deep text-white hover:bg-[#2b2752]`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden /> {editable ? "Edit itinerary" : "View itinerary"}
        </Link>
      )}
      {t.itinerary_id && (
        <Link href={`/trips/${t.id}/review`} className={`${cls} border border-border hover:bg-surface-muted`}>
          {compact ? <List className="h-3.5 w-3.5" aria-hidden /> : <LayoutGrid className="h-3.5 w-3.5" aria-hidden />} View details
        </Link>
      )}
    </div>
  );
}
