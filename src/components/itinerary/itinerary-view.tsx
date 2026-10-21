"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, BedDouble, Bus, CalendarDays, Clock, Coffee, Lightbulb, MapPin, Plane, Plus, RefreshCw, Replace, Save, Send, Sparkles, Trash2, Users, Wand2 } from "lucide-react";
import { api, errorMessage, newClientId, useApi } from "@/lib/client/api";
import { formatDate, formatMoney, formatMonth } from "@/lib/client/format";
import type { Itinerary, ItineraryDay, ItineraryItem, TripDetail } from "@/lib/client/types";
import { AiBadge, Badge, Breadcrumbs, Button, Card, CardHeader, EmptyState, ErrorState, GlassPanel, Modal, Select, Skeleton, Spinner, TypingIndicator, cn } from "@/components/ui";
import { useConfirm, useToast } from "@/components/feedback";
import { TripStatusBadge } from "@/components/status";
import { DestinationImage } from "@/components/destination-image";
import { RichText } from "@/components/rich-text";
import { BudgetCard } from "./budget-card";

interface Alternative {
  id: string;
  title: string;
  area: string;
  hours: number;
  costPerPerson: number;
  tags: string[];
  description: string;
}
interface DestinationSummary {
  id: string;
  name: string;
  image: string;
  tagline: string;
}

type Picker = { mode: "replace"; itemId: string; title: string } | { mode: "add"; dayNumber: number } | null;

const ASSIST = [
  { label: "Cheaper options", message: "Show cheaper options" },
  { label: "Slower pace", message: "Make it slower" },
  { label: "Family-friendly", message: "Make it more family-friendly" },
  { label: "More culture", message: "Add more cultural experiences" },
  { label: "More adventure", message: "Make it more adventurous" },
];

/** Indicative schedule: starts 09:00, items back to back with a 30-minute buffer. Display-only. */
function schedule(day: ItineraryDay): string[] {
  let minutes = 9 * 60;
  return day.items.map((i) => {
    const start = minutes;
    minutes += Math.round((i.durationHours ?? (i.kind === "free_time" ? 2 : 1)) * 60) + 30;
    const h = Math.floor(start / 60);
    const m = start % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });
}

export function ItineraryView({ tripId }: { tripId: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload, setData } = useApi<TripDetail>(`/api/trips/${tripId}`);
  const destinations = useApi<{ items: DestinationSummary[] }>("/api/destinations");
  const [busy, setBusy] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<number[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [assistInput, setAssistInput] = useState("");
  const [assistReply, setAssistReply] = useState<string | null>(null);

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-4 px-5 py-6">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="px-4 py-10">
        <Card className="mx-auto max-w-lg">
          <ErrorState error={error} onRetry={reload} />
        </Card>
      </div>
    );
  }

  const { trip, itinerary, profile } = data;
  const dest = destinations.data?.items.find((d) => d.id === (itinerary?.destinationId ?? trip.destination_id));

  async function generate(force: boolean) {
    if (force && itinerary && !(await confirm({ title: "Regenerate the whole itinerary?", description: "A new version replaces the current day plan. Your manual edits to this version will not carry over.", confirmLabel: "Regenerate" }))) return;
    setBusy("generate");
    try {
      const res = await api<{ itinerary: Itinerary; reused: boolean }>("/api/itineraries/generate", { body: { tripId, force } });
      setData((d) => (d ? { ...d, itinerary: res.itinerary } : d));
      toast({ tone: "success", title: res.reused ? "Itinerary unchanged" : `Itinerary v${res.itinerary.version} generated`, description: res.reused ? "Your preferences haven't changed, so the saved itinerary was kept (no AI call)." : undefined });
      reload();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't generate the itinerary", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function edit(body: Record<string, unknown>, key: string) {
    if (!itinerary) return;
    setBusy(key);
    try {
      const res = await api<{ itinerary: Itinerary; description: string; affectedDays: number[] }>(`/api/itineraries/${itinerary.id}`, { method: "PATCH", body });
      setData((d) => (d ? { ...d, itinerary: res.itinerary } : d));
      setHighlight(res.affectedDays);
      toast({ tone: "success", title: res.description, description: `New estimate ${formatMoney(res.itinerary.budget.total)} — recalculated in code.` });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't update the itinerary", description: errorMessage(e) });
    } finally {
      setBusy(null);
      setPicker(null);
    }
  }

  async function ask(message: string) {
    const text = message.trim();
    if (!text) return;
    setBusy("assist");
    setAssistReply(null);
    try {
      const res = await api<{ turn: { reply: string; itineraryUpdate?: { actions: { status: string }[] } | null } }>("/api/ai/chat", {
        body: { mode: "planner", tripId, message: text, clientMessageId: newClientId("it") },
      });
      setAssistReply(res.turn.reply);
      setAssistInput("");
      if (res.turn.itineraryUpdate?.actions.some((a) => a.status === "completed")) {
        reload();
        toast({ tone: "success", title: "Itinerary updated by the AI planner" });
      }
    } catch (e) {
      toast({ tone: "error", title: "The planner couldn't do that", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function saveTrip() {
    setBusy("save");
    try {
      await api(`/api/trips/${tripId}`, { method: "PATCH", body: { status: "saved" } });
      toast({ tone: "success", title: "Trip saved to My Trips" });
      reload();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save the trip", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  const canSave = trip.status === "planning" || trip.status === "itinerary_ready";
  const generatedLive = itinerary?.generatedBy.startsWith("openai:");
  const travellers = (profile.adults ?? 0) + (profile.children ?? 0);

  return (
    <div className="mx-auto max-w-[1440px] px-3 py-4 sm:px-5 sm:py-5">
      <Breadcrumbs items={[{ label: "My Trips", href: "/trips" }, { label: trip.title }, { label: "Itinerary" }]} />

      {/* Destination header */}
      <div className="relative mb-5 overflow-hidden rounded-2xl">
        <DestinationImage src={dest?.image} alt={dest?.name ?? trip.title} className="absolute inset-0" eager />
        <div className="absolute inset-0 bg-gradient-to-r from-[#17152f]/90 via-[#17152f]/60 to-[#17152f]/10" />
        <div className="relative flex flex-col gap-4 p-5 text-white sm:p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TripStatusBadge status={trip.status} />
              {itinerary && (generatedLive ? <AiBadge>AI-planned · {itinerary.generatedBy.replace("openai:", "")}</AiBadge> : <Badge tone="neutral">{itinerary.generatedBy.includes("fallback") ? "Standard planner (AI fallback)" : "Rules-based planner (demo mode)"}</Badge>)}
              <Badge tone="amber">Prices are estimates</Badge>
            </div>
            <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">{trip.title}</h1>
            {itinerary && <p className="mt-1 max-w-2xl text-[13px] text-white/85">{itinerary.summary}</p>}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-white/85">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4" aria-hidden />
                {trip.start_date && trip.end_date ? `${formatDate(trip.start_date)} – ${formatDate(trip.end_date)}` : trip.travel_month ? `${formatMonth(trip.travel_month)} (flexible)` : "Dates to be decided"}
                {trip.duration_days ? ` · ${trip.duration_days} days` : ""}
              </span>
              {travellers > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4" aria-hidden /> {profile.adults} adult{profile.adults === 1 ? "" : "s"}
                  {profile.children ? `, ${profile.children} child${profile.children === 1 ? "" : "ren"}` : ""}
                </span>
              )}
              {profile.pace && <span>Pace: {profile.pace}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/plan?trip=${tripId}`} className="inline-flex h-9 items-center rounded-lg border border-white/25 bg-white/10 px-3.5 text-sm font-medium text-white backdrop-blur hover:bg-white/20">
              Edit preferences
            </Link>
            {canSave && itinerary && (
              <Button variant="secondary" onClick={saveTrip} loading={busy === "save"}>
                <Save className="h-4 w-4" aria-hidden /> Save trip
              </Button>
            )}
            {itinerary && trip.status !== "cancelled" && <Button onClick={() => router.push(`/trips/${tripId}/review`)}>Review &amp; book</Button>}
          </div>
        </div>
      </div>

      {!itinerary ? (
        <Card>
          <EmptyState
            icon={<Wand2 className="h-5 w-5" />}
            title="No itinerary yet"
            description={trip.destination_id ? "Generate a day-by-day plan from your trip profile." : "Choose a destination in the planner first."}
            action={
              trip.destination_id ? (
                <Button variant="ai" onClick={() => generate(false)} loading={busy === "generate"}>
                  Generate itinerary
                </Button>
              ) : (
                <Link href={`/plan?trip=${tripId}`} className="text-sm font-medium text-primary hover:underline">
                  Go to planner
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_340px]">
          {/* Day navigation */}
          <nav aria-label="Days" className="lg:sticky lg:top-5 lg:self-start">
            <GlassPanel className="p-2">
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Day by day</p>
              <ol className="flex gap-1 overflow-x-auto lg:flex-col">
                {itinerary.days.map((d) => (
                  <li key={d.id} className="shrink-0">
                    <a href={`#day-${d.dayNumber}`} className={cn("block rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-surface", highlight.includes(d.dayNumber) && "bg-accent-soft")}>
                      <span className="font-medium">Day {d.dayNumber}</span>
                      <span className="block max-w-[11rem] truncate text-[11px] text-muted">{d.date ? formatDate(d.date) : d.area ?? d.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </GlassPanel>
          </nav>

          {/* Days */}
          <div className="min-w-0 space-y-4">
            {itinerary.days.map((day) => {
              const times = schedule(day);
              return (
                <Card key={day.id} id={`day-${day.dayNumber}`} className={cn("scroll-mt-5 transition-shadow", highlight.includes(day.dayNumber) && "ring-2 ring-accent/40")}>
                  <CardHeader
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">Day {day.dayNumber}</span>
                        {day.title}
                      </span>
                    }
                    description={
                      <span className="flex flex-wrap gap-3">
                        {day.date && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {formatDate(day.date)}
                          </span>
                        )}
                        {day.area && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" aria-hidden /> {day.area}
                          </span>
                        )}
                        <span>{formatMoney(day.items.reduce((s, i) => s + i.estCost, 0))} in activities</span>
                      </span>
                    }
                    action={
                      (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setPicker({ mode: "add", dayNumber: day.dayNumber })} aria-label={`Add activity to day ${day.dayNumber}`}>
                            <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Add</span>
                          </Button>
                          <Button variant="ghost" size="sm" loading={busy === `regen-${day.dayNumber}`} onClick={() => edit({ op: "regenerateDay", dayNumber: day.dayNumber }, `regen-${day.dayNumber}`)} aria-label={`Regenerate day ${day.dayNumber}`}>
                            <RefreshCw className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Regenerate day</span>
                          </Button>
                        </div>
                      )
                    }
                  />
                  <ol className="px-4 py-2">
                    {day.items.map((item, idx) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        time={times[idx]}
                        first={idx === 0}
                        last={idx === day.items.length - 1}
                        days={itinerary.days.map((d) => d.dayNumber)}
                        dayNumber={day.dayNumber}
                        busy={busy}
                        onEdit={edit}
                        onReplace={() => setPicker({ mode: "replace", itemId: item.id, title: item.title })}
                        onRemove={async () => {
                          if (await confirm({ title: `Remove “${item.title}”?`, description: "The budget will be recalculated. You can add it back later from the alternatives list.", confirmLabel: "Remove", tone: "danger" })) {
                            void edit({ op: "remove", itemId: item.id }, `remove-${item.id}`);
                          }
                        }}
                      />
                    ))}
                  </ol>
                </Card>
              );
            })}
            <p className="text-xs text-muted">Times are an indicative schedule (09:00 start, 30-minute buffers). Your travel expert confirms final timings.</p>
            <Button variant="secondary" onClick={() => generate(true)} loading={busy === "generate"}>
              <Wand2 className="h-4 w-4" aria-hidden /> Regenerate whole itinerary
            </Button>
          </div>

          {/* Assist + budget */}
          <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
            <Card className="ai-edge overflow-hidden p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Sparkles className="h-4 w-4" aria-hidden />
                </span>
                <h2 className="text-[15px] font-semibold">Ask the AI planner</h2>
              </div>
              <p className="mt-1 text-xs text-muted">Changes run through the planner&apos;s tools; totals are recalculated in code.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ASSIST.map((a) => (
                  <button key={a.label} disabled={busy === "assist"} onClick={() => ask(a.message)} className="rounded-full border border-accent/30 bg-accent-soft/60 px-2.5 py-1 text-xs hover:border-accent disabled:opacity-50">
                    {a.label}
                  </button>
                ))}
              </div>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(assistInput);
                }}
              >
                <label htmlFor="assist-input" className="sr-only">
                  Ask for a change
                </label>
                <input
                  id="assist-input"
                  value={assistInput}
                  maxLength={300}
                  onChange={(e) => setAssistInput(e.target.value)}
                  placeholder="e.g. replace the water park"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
                <Button type="submit" size="md" disabled={!assistInput.trim() || busy === "assist"} aria-label="Send request to the AI planner">
                  <Send className="h-4 w-4" aria-hidden />
                </Button>
              </form>
              {busy === "assist" && (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted">
                  <TypingIndicator /> Updating your plan…
                </p>
              )}
              {assistReply && (
                <div className="mt-3 rounded-lg bg-surface-muted p-3 text-[13px]">
                  <RichText text={assistReply} />
                </div>
              )}
            </Card>
            <BudgetCard budget={itinerary.budget} />
            <Card>
              <CardHeader title="Stay" description={`${itinerary.hotel.rooms} room${itinerary.hotel.rooms > 1 ? "s" : ""} × ${itinerary.hotel.nights} nights`} />
              <div className="space-y-3 p-4 text-[13px]">
                <div className="flex gap-3">
                  <BedDouble className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="font-medium">{itinerary.hotel.name}</p>
                    <p className="text-muted">
                      {itinerary.hotel.area} · {itinerary.hotel.highlights}
                    </p>
                    <p className="mt-1 tabular-nums">
                      {formatMoney(itinerary.hotel.nightlyRate)}/night · {formatMoney(itinerary.hotel.total)} total <span className="text-xs text-muted">(estimate)</span>
                    </p>
                  </div>
                </div>
                <label className="block text-xs text-muted" htmlFor="hotel-tier">
                  Change hotel level
                </label>
                <Select id="hotel-tier" value={itinerary.hotel.tier} disabled={busy === "hotel"} onChange={(e) => edit({ op: "setHotelTier", tier: e.target.value }, "hotel")}>
                  <option value="budget">Budget / 3★</option>
                  <option value="midrange">Comfort / 4★</option>
                  <option value="luxury">Luxury / 5★</option>
                </Select>
                <p className="text-xs text-muted">Hotel names are generic samples, not specific properties.</p>
              </div>
            </Card>
            <Card>
              <CardHeader title="Getting there & around" />
              <div className="space-y-3 p-4 text-[13px]">
                <div className="flex gap-3">
                  <Plane className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="font-medium">{itinerary.transport.flights.included ? `${itinerary.transport.flights.from ?? "India"} → ${itinerary.transport.flights.to}` : "Flights not included"}</p>
                    <p className="text-muted">{itinerary.transport.flights.note}</p>
                    {itinerary.transport.flights.included && <p className="mt-1 tabular-nums">{formatMoney(itinerary.transport.flights.total)} total</p>}
                  </div>
                </div>
                <div className="flex gap-3">
                  <Bus className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <div>
                    <p className="font-medium">Local transport</p>
                    <p className="text-muted">{itinerary.transport.local.note}</p>
                    <p className="mt-1 tabular-nums">{formatMoney(itinerary.transport.local.total)} total</p>
                  </div>
                </div>
              </div>
            </Card>
          </aside>
        </div>
      )}

      {picker && itinerary && (
        <AlternativesPicker
          itineraryId={itinerary.id}
          picker={picker}
          busy={busy === "pick"}
          onClose={() => setPicker(null)}
          onPick={(id) => (picker.mode === "replace" ? edit({ op: "replace", itemId: picker.itemId, catalogRef: id }, "pick") : edit({ op: "add", dayNumber: picker.dayNumber, catalogRef: id }, "pick"))}
        />
      )}
    </div>
  );
}

function ItemRow({
  item,
  time,
  first,
  last,
  days,
  dayNumber,
  busy,
  onEdit,
  onReplace,
  onRemove,
}: {
  item: ItineraryItem;
  time: string;
  first: boolean;
  last: boolean;
  days: number[];
  dayNumber: number;
  busy: string | null;
  onEdit: (body: Record<string, unknown>, key: string) => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const Icon = item.kind === "transfer" ? Plane : item.kind === "free_time" ? Coffee : MapPin;
  const isActivity = item.kind === "activity";
  return (
    <li className="relative flex gap-3 py-3 pl-1">
      {!last && <span className="absolute left-[23px] top-12 h-[calc(100%-2.25rem)] w-px bg-border" aria-hidden />}
      <div className="flex w-12 shrink-0 flex-col items-center">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", isActivity ? "bg-accent-soft text-accent" : "bg-surface-muted text-muted")}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] tabular-nums text-muted">
          <Clock className="h-3 w-3" aria-hidden />
          {time}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium">{item.title}</p>
          {isActivity && <p className="text-sm tabular-nums">{item.estCost ? formatMoney(item.estCost) : "Free"}</p>}
        </div>
        <p className="mt-0.5 text-[13px] text-muted">
          {item.description}
          {item.durationHours ? ` · ~${item.durationHours}h` : ""}
        </p>
        {item.reason && (
          <p className="mt-1.5 inline-flex items-start gap-1.5 rounded-md bg-primary-soft/70 px-2 py-1 text-xs text-slate-700">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium">Why: </span>
              {item.reason}
            </span>
          </p>
        )}
        {isActivity && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onReplace} aria-label={`Replace ${item.title}`}>
              <Replace className="h-3.5 w-3.5" aria-hidden /> Replace
            </Button>
            <Button variant="ghost" size="sm" disabled={first || !!busy} onClick={() => onEdit({ op: "move", itemId: item.id, direction: "up" }, `move-${item.id}`)} aria-label={`Move ${item.title} up`}>
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" disabled={last || !!busy} onClick={() => onEdit({ op: "move", itemId: item.id, direction: "down" }, `move-${item.id}`)} aria-label={`Move ${item.title} down`}>
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <label className="sr-only" htmlFor={`move-${item.id}`}>
              Move {item.title} to another day
            </label>
            <select
              id={`move-${item.id}`}
              className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
              value=""
              disabled={!!busy}
              onChange={(e) => e.target.value && onEdit({ op: "moveToDay", itemId: item.id, dayNumber: Number(e.target.value) }, `move-${item.id}`)}
            >
              <option value="">Move to day…</option>
              {days
                .filter((d) => d !== dayNumber)
                .map((d) => (
                  <option key={d} value={d}>
                    Day {d}
                  </option>
                ))}
            </select>
            <Button variant="ghost" size="sm" className="text-danger" loading={busy === `remove-${item.id}`} onClick={onRemove} aria-label={`Remove ${item.title}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function AlternativesPicker({ itineraryId, picker, busy, onClose, onPick }: { itineraryId: string; picker: NonNullable<Picker>; busy: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const url = `/api/itineraries/${itineraryId}/alternatives${picker.mode === "replace" ? `?itemId=${picker.itemId}` : ""}`;
  const { data, error, loading, reload } = useApi<{ items: Alternative[] }>(url);
  return (
    <Modal open onClose={onClose} title={picker.mode === "replace" ? `Replace “${picker.title}”` : `Add an activity to day ${picker.dayNumber}`} wide>
      <p className="mb-3 text-xs text-muted">Suitable activities for your group that aren&apos;t already in the plan, ranked by fit. Prices are estimates per person.</p>
      {loading && <Spinner label="Finding suitable activities" />}
      {error && <ErrorState error={error} onRetry={reload} compact />}
      {data && data.items.length === 0 && <EmptyState title="No more suitable activities" description="Every activity that suits your group is already in the plan." />}
      <ul className="space-y-2">
        {data?.items.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="font-medium">{a.title}</p>
              <p className="text-[13px] text-muted">
                {a.area} · ~{a.hours}h · {a.costPerPerson ? `${formatMoney(a.costPerPerson)} pp (est.)` : "Free"}
              </p>
              <p className="mt-1 text-xs text-muted">{a.description}</p>
            </div>
            <Button size="sm" loading={busy} onClick={() => onPick(a.id)}>
              Choose
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
