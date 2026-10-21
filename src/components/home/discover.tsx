"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarDays, Sparkles } from "lucide-react";
import { formatMoney } from "@/lib/client/format";
import { Input, Select, cn } from "@/components/ui";
import { DestinationImage } from "@/components/destination-image";

export interface DestinationSummary {
  id: string;
  name: string;
  country: string;
  image: string;
  tagline: string;
  bestMonths: number[];
  interests: string[];
  idealDays: [number, number];
  fromPricePerPerson: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FILTERS = [
  { id: "beaches", label: "Beaches" },
  { id: "culture", label: "Culture" },
  { id: "adventure", label: "Adventure" },
  { id: "family_fun", label: "Family" },
  { id: "romance", label: "Romance" },
  { id: "food", label: "Food" },
  { id: "nature", label: "Nature" },
];

/** Destination discovery with simple filters (client-side over the catalog — no AI call). */
export function Discover({
  destinations,
  initialQuery = "",
  initialInterest = null,
  title = "Featured destinations",
  description = "“From” prices are per person for 5 days incl. flights — estimates from sample data, not live fares.",
}: {
  destinations: DestinationSummary[];
  initialQuery?: string;
  initialInterest?: string | null;
  title?: string;
  description?: string;
}) {
  const [interest, setInterest] = useState<string | null>(initialInterest);
  const [month, setMonth] = useState<number | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [budget, setBudget] = useState<number | null>(null);
  const [days, setDays] = useState<string>("");
  const filtered = destinations.filter(
    (d) =>
      (!interest || d.interests.includes(interest)) &&
      (!month || d.bestMonths.includes(month)) &&
      (!query.trim() || `${d.name} ${d.country} ${d.tagline}`.toLowerCase().includes(query.trim().toLowerCase())) &&
      (!budget || d.fromPricePerPerson <= budget) &&
      (!days || (days === "short" ? d.idealDays[0] <= 4 : days === "week" ? d.idealDays[0] <= 7 && d.idealDays[1] >= 5 : d.idealDays[1] >= 8)),
  );
  return (
    <section aria-labelledby="discover" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-3">
        <div>
          <h2 id="discover" className="text-[19px] font-semibold tracking-tight">
            {title}
          </h2>
          <p className="mt-1 text-[13px] text-muted">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="search" aria-label="Filter destinations" placeholder="Filter destinations" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 w-44" />
          <Select aria-label="Budget per person" className="h-8 w-40 text-sm" value={budget ?? ""} onChange={(e) => setBudget(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any budget</option>
            <option value="60000">Up to ₹60k pp</option>
            <option value="90000">Up to ₹90k pp</option>
            <option value="150000">Up to ₹1.5L pp</option>
          </Select>
          <Select aria-label="Trip length" className="h-8 w-36 text-sm" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="">Any length</option>
            <option value="short">Short (≤4 days)</option>
            <option value="week">About a week</option>
            <option value="long">8+ days</option>
          </Select>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              aria-pressed={interest === f.id}
              onClick={() => setInterest(interest === f.id ? null : f.id)}
              className={cn("rounded-full border px-3 py-1 text-[13px] transition-colors", interest === f.id ? "border-nav-deep bg-nav-deep text-white" : "border-lavender/70 bg-surface hover:bg-lavender-surface")}
            >
              {f.label}
            </button>
          ))}
          <Select aria-label="Travel month" className="h-8 w-36 text-sm" value={month ?? ""} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Any month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                Best in {m}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-lavender p-8 text-center text-sm text-muted">
          No destination in our catalog matches these filters.{" "}
          <Link href="/plan?q=Suggest%20destinations%20for%20me" className="font-medium text-primary hover:underline">
            Ask the AI planner for ideas
          </Link>
        </p>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filtered.map((d, i) => (
            <Link
              key={d.id}
              href={`/plan?q=${encodeURIComponent(`I'd like to visit ${d.name}`)}`}
              className="surface group flex flex-col overflow-hidden rounded-2xl transition-shadow hover:shadow-[0_14px_36px_-16px_rgba(60,42,100,0.35)]"
              aria-label={`Plan a trip to ${d.name}`}
            >
              <div className="relative aspect-[3/2]">
                <DestinationImage src={d.image} alt={`${d.name}, ${d.country}`} seed={i} className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.03]" card />
                <span className="absolute left-2.5 top-2.5 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-medium text-foreground backdrop-blur">
                  {d.idealDays[0]}–{d.idealDays[1]} days
                </span>
                <span className="absolute bottom-2.5 right-2.5 rounded-full bg-nav-deep/85 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                  from {formatMoney(d.fromPricePerPerson)}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-3.5">
                <h3 className="font-semibold leading-tight">
                  {d.name} <span className="text-xs font-normal text-muted">· {d.country}</span>
                </h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{d.tagline}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-2.5 text-xs">
                  <span className="inline-flex items-center gap-1 text-muted">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Best {d.bestMonths.slice(0, 3).map((m) => MONTHS[m - 1]).join(", ")}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden /> Plan
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
