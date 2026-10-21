"use client";

import Link from "next/link";
import { CheckCircle2, LifeBuoy, MessageSquareText, Route, ShieldCheck } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { formatMoney, relativeTime } from "@/lib/client/format";
import { Card, Skeleton } from "@/components/ui";
import { TripStatusBadge } from "@/components/status";

interface TripItem {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  estimated_total: number | null;
  itinerary_id: string | null;
}

/** Resume unfinished plans and see saved trips — or, for new visitors, how the planner works. */
export function ContinuePanel() {
  const { data, loading } = useApi<{ items: TripItem[] }>("/api/trips");
  const trips = (data?.items ?? []).filter((t) => t.status !== "cancelled").slice(0, 4);
  if (loading && !data) {
    return (
      <Card className="space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </Card>
    );
  }
  if (trips.length) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Continue where you left off</h2>
          <Link href="/trips" className="text-xs font-medium text-primary hover:underline">
            All trips
          </Link>
        </div>
        <ul className="mt-3 space-y-2">
          {trips.map((t) => (
            <li key={t.id}>
              <Link
                href={t.itinerary_id ? `/trips/${t.id}/itinerary` : `/plan?trip=${t.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 hover:border-primary/40 hover:bg-primary-soft/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{t.title}</span>
                  <span className="block text-xs text-muted">
                    {t.itinerary_id ? "Itinerary ready" : "Planning in progress"} · {relativeTime(t.updated_at)}
                    {t.estimated_total ? ` · ${formatMoney(t.estimated_total)} est.` : ""}
                  </span>
                </span>
                <TripStatusBadge status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">How it works</h2>
      <ol className="mt-3 space-y-3 text-sm">
        {[
          { icon: MessageSquareText, title: "Tell us once", body: "Describe your trip in a sentence. The planner remembers everything and asks only what's missing." },
          { icon: Route, title: "Get a day-by-day plan", body: "Activities matched to your interests and pace, hotels and transport, with a transparent cost estimate." },
          { icon: CheckCircle2, title: "Refine, save, request a quote", body: "Ask for a slower pace or cheaper options, then send it to a travel expert. Nothing is booked without you." },
        ].map((s) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <s.icon className="h-4 w-4" aria-hidden />
            </span>
            <span>
              <span className="block font-medium">{s.title}</span>
              <span className="block text-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden /> No payment to plan
        </span>
        <Link href="/support" className="inline-flex items-center gap-1 hover:text-foreground">
          <LifeBuoy className="h-3.5 w-3.5" aria-hidden /> Need help? Support
        </Link>
      </div>
    </Card>
  );
}
