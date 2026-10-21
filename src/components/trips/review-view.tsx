"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, MinusCircle, PlaneLanding, PlaneTakeoff, ShieldCheck, Users } from "lucide-react";
import { api, errorMessage, newClientId, useApi } from "@/lib/client/api";
import { formatDate, formatDateTime, formatMoney, formatMonth } from "@/lib/client/format";
import type { Handoff, TripDetail } from "@/lib/client/types";
import { FIELD_KEYS, FIELD_LABELS, describeField } from "@/lib/planner/profile";
import { Alert, Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, Skeleton, Textarea } from "@/components/ui";
import { useToast } from "@/components/feedback";
import { BookingLifecycle, OpsStatusBadge, ProviderStatusBadge } from "@/components/status";
import { BudgetCard } from "@/components/itinerary/budget-card";

const EDIT_LINK_FIELDS = new Set(["destination", "dates", "duration", "travellers", "budget", "accommodation", "transport"]);

export function ReviewView({ tripId }: { tripId: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<TripDetail>(`/api/trips/${tripId}`);
  const me = useApi<{ user: { name: string; email: string; phone: string | null } | null }>("/api/profile");
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ handoff: Handoff; message: string } | null>(null);
  // One idempotency key per page visit: double-clicks and retries can't create duplicate requests.
  const [idempotencyKey] = useState(() => newClientId("handoff"));

  // Prefill contact details for signed-in customers (they can still edit them).
  const user = me.data?.user;
  useEffect(() => {
    if (!user) return;
    queueMicrotask(() => setForm((f) => (f.name || f.email ? f : { ...f, name: user.name, email: user.email, phone: user.phone ?? "" })));
  }, [user]);

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-5 py-6">
        <Skeleton className="h-10 w-1/3" />
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
  const { trip, itinerary, profile, status } = data;
  const handoff = result?.handoff ?? data.handoff;

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await api<{ handoff: Handoff; message: string }>("/api/bookings/handoff", {
        body: { tripId, contactName: form.name, contactEmail: form.email, contactPhone: form.phone || null, notes: form.notes || null, confirm: confirmed ? true : undefined, idempotencyKey },
      });
      setResult(res);
      toast({ tone: "success", title: "Quote request sent to our travel experts", description: "Nothing has been booked or charged." });
      reload();
    } catch (e) {
      setSubmitError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const activities = itinerary?.days.flatMap((d) => d.items.filter((i) => i.kind === "activity").map((i) => ({ ...i, day: d.dayNumber }))) ?? [];
  const openHandoff = handoff && !["failed", "cancelled"].includes(handoff.ops_status);
  const b = itinerary?.budget;
  const included = itinerary
    ? [
        itinerary.transport.flights.included ? `Return ${itinerary.transport.flights.cabin.replace("_", " ")} flights (estimate)` : null,
        `${itinerary.hotel.nights} nights at ${itinerary.hotel.name}, ${itinerary.hotel.rooms} room${itinerary.hotel.rooms > 1 ? "s" : ""}`,
        `${activities.length} activities listed in the itinerary`,
        "Airport transfers and day-trip local transport",
        "Meals (estimated allowance)",
      ].filter(Boolean)
    : [];
  const excluded = [
    !itinerary?.transport.flights.included ? "Flights (you'll book them yourself)" : null,
    "Visa fees and travel insurance",
    "Personal shopping, tips and optional extras",
    "Price changes after the final quote",
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
      <PageHeader
        breadcrumbs={[{ label: "My Trips", href: "/trips" }, { label: trip.title, href: `/trips/${tripId}/itinerary` }, { label: "Review & quote" }]}
        title="Review & request a quote"
        description="Check every detail. A travel expert confirms availability and sends a final quote — nothing is booked or charged until you approve it."
      />

      {!itinerary ? (
        <Card className="p-6">
          <p>Generate an itinerary before requesting a quote.</p>
          <Link href={`/trips/${tripId}/itinerary`} className="mt-2 inline-block text-sm font-medium text-primary hover:underline">
            Go to itinerary
          </Link>
        </Card>
      ) : (
        <>
          <Card className="mb-5 p-4">
            <BookingLifecycle hasItinerary opsStatus={handoff?.ops_status} providerStatus={handoff?.provider_status} />
          </Card>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-5">
              <Card>
                <CardHeader title="Travellers & travel dates" />
                <div className="grid gap-4 p-4 text-[13px] sm:grid-cols-3">
                  <div className="flex gap-2.5">
                    <Users className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                    <div>
                      <p className="text-xs text-muted">Travellers</p>
                      <p className="font-medium">{describeField("travellers", profile, status) ?? "Not set"}</p>
                      {profile.childrenAges.length > 0 && <p className="text-xs text-muted">Children aged {profile.childrenAges.join(", ")}</p>}
                    </div>
                  </div>
                  <div className="flex gap-2.5">
                    <PlaneTakeoff className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                    <div>
                      <p className="text-xs text-muted">Departure</p>
                      <p className="font-medium">{trip.start_date ? formatDate(trip.start_date) : trip.travel_month ? `${formatMonth(trip.travel_month)} (flexible)` : "Date to be decided"}</p>
                      <p className="text-xs text-muted">From {profile.departureCity ?? "a major Indian city"}</p>
                    </div>
                  </div>
                  <div className="flex gap-2.5">
                    <PlaneLanding className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                    <div>
                      <p className="text-xs text-muted">Return</p>
                      <p className="font-medium">{trip.end_date ? formatDate(trip.end_date) : trip.duration_days ? `After ${trip.duration_days} days` : "To be decided"}</p>
                      <p className="text-xs text-muted">Arriving {itinerary.transport.flights.to}</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader title="Trip summary" description="Edit anything before an expert confirms." />
                <dl className="grid gap-x-6 gap-y-2.5 p-4 sm:grid-cols-2">
                  {FIELD_KEYS.map((f) => {
                    const v = describeField(f, profile, status);
                    if (!v) return null;
                    return (
                      <div key={f} className="flex items-start justify-between gap-2 border-b border-border/60 pb-2">
                        <div>
                          <dt className="text-[11px] text-muted">{FIELD_LABELS[f]}</dt>
                          <dd className="text-[13px]">{v}</dd>
                        </div>
                        {EDIT_LINK_FIELDS.has(f) && (
                          <Link href={`/plan?trip=${tripId}`} className="text-xs font-medium text-primary hover:underline">
                            Edit
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </dl>
              </Card>

              <Card>
                <CardHeader
                  title="Accommodation & activities"
                  action={
                    <Link href={`/trips/${tripId}/itinerary`} className="text-sm font-medium text-primary hover:underline">
                      Edit itinerary
                    </Link>
                  }
                />
                <div className="p-4">
                  <p className="text-[13px]">
                    <span className="font-medium">{itinerary.hotel.name}</span> — {itinerary.hotel.rooms} room(s) × {itinerary.hotel.nights} nights · {formatMoney(itinerary.hotel.total)}
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted">
                          <th className="py-2 font-medium">Day</th>
                          <th className="py-2 font-medium">Activity</th>
                          <th className="py-2 text-right font-medium">Est. cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activities.map((a) => (
                          <tr key={a.id} className="border-b border-border/60">
                            <td className="py-2 pr-2 text-muted">{a.day}</td>
                            <td className="py-2">{a.title}</td>
                            <td className="py-2 text-right tabular-nums">{a.estCost ? formatMoney(a.estCost) : "Free"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader title="What's included" description="Based on your itinerary estimate; the final quote confirms inclusions." />
                <div className="grid gap-4 p-4 text-[13px] sm:grid-cols-2">
                  <ul className="space-y-1.5">
                    {included.map((i) => (
                      <li key={i} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> {i}
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-1.5">
                    {excluded.map((i) => (
                      <li key={i} className="flex gap-2 text-muted">
                        <MinusCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Not included: {i}
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Special requirements"
                  description="Shared with your travel expert with the quote request."
                  action={
                    <Link href={`/plan?trip=${tripId}`} className="text-xs font-medium text-primary hover:underline">
                      Edit
                    </Link>
                  }
                />
                <dl className="grid gap-3 p-4 text-[13px] sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] text-muted">Dietary, accessibility &amp; other needs</dt>
                    <dd className="mt-0.5">{describeField("requirements", profile, status) ?? "None mentioned — add any in the notes below."}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted">Must-sees &amp; special requests</dt>
                    <dd className="mt-0.5">{describeField("mustSee", profile, status) ?? "None mentioned."}</dd>
                  </div>
                </dl>
              </Card>
            </div>

            <aside className="space-y-4">
              {b && <BudgetCard budget={b} />}
              {openHandoff && handoff ? (
                <Card>
                  <CardHeader title="Quote request status" />
                  <div className="space-y-3 p-4 text-[13px]">
                    <p>
                      Sent to our travel experts on {formatDateTime(handoff.customer_confirmed_at)}. <strong>Nothing has been booked or charged yet.</strong>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <OpsStatusBadge status={handoff.ops_status} />
                      <ProviderStatusBadge status={handoff.provider_status} reference={handoff.provider_reference} />
                    </div>
                    {result?.message && <Alert tone="blue">{result.message}</Alert>}
                    {handoff.quoted_total && <p>Quoted total from our team: {formatMoney(handoff.quoted_total)}</p>}
                    <p className="text-xs text-muted">A travel expert will contact {handoff.contact_email} with availability and a final quote.</p>
                    <div className="flex flex-wrap gap-3">
                      <Link href="/trips" className="font-medium text-primary hover:underline">
                        Back to My Trips
                      </Link>
                      <Link href="/support" className="font-medium text-primary hover:underline">
                        Questions? Contact support
                      </Link>
                    </div>
                  </div>
                </Card>
              ) : trip.status === "cancelled" ? (
                <Alert tone="amber">This trip was cancelled. Duplicate it from My Trips to plan again.</Alert>
              ) : (
                <Card>
                  <CardHeader title="Request a quote" description="Confirm your contact details." />
                  <form
                    className="space-y-3.5 p-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submit();
                    }}
                  >
                    <Field label="Full name" htmlFor="h-name">
                      <Input id="h-name" required minLength={2} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </Field>
                    <Field label="Email" htmlFor="h-email">
                      <Input id="h-email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </Field>
                    <Field label="Phone (optional)" htmlFor="h-phone">
                      <Input id="h-phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </Field>
                    <Field label="Notes for the travel expert (optional)" htmlFor="h-notes">
                      <Textarea id="h-notes" maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </Field>
                    <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/70 p-3 text-[13px]">
                      <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                      <span>
                        I confirm I want a travel expert to check availability for this trip (estimated {formatMoney(itinerary.budget.total)}) and send me a final quote. I understand <strong>nothing is booked or charged yet</strong> and prices may change.
                      </span>
                    </label>
                    {submitError && <Alert tone="red">{submitError}</Alert>}
                    <Button type="submit" className="w-full" loading={busy} disabled={!confirmed}>
                      <ShieldCheck className="h-4 w-4" aria-hidden /> Send booking request
                    </Button>
                  </form>
                </Card>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
