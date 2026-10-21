import Link from "next/link";
import { ArrowRight, CalendarDays, Sparkles } from "lucide-react";
import { listDestinationSummaries } from "@/lib/catalog/destinations";
import { formatMoney } from "@/lib/planner/profile";
import { Breadcrumbs } from "@/components/ui";
import { Discover } from "@/components/home/discover";

export const metadata = { title: "Destinations & inspiration" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const INTERESTS = ["beaches", "culture", "adventure", "family_fun", "romance", "food", "nature"];

export default async function DestinationsPage(props: PageProps<"/destinations">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const interest = typeof sp.interest === "string" && INTERESTS.includes(sp.interest) ? sp.interest : null;
  const destinations = listDestinationSummaries();
  const month = new Date().getMonth() + 1;
  const inSeason = destinations.filter((d) => d.bestMonths.includes(month)).slice(0, 3);

  return (
    <div className="pb-4">
      <section className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Destinations" }]} />
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Destinations &amp; inspiration</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">
          Browse every destination the planner can build a full itinerary for. Pick one to start planning — the AI asks only for what it still needs.
        </p>
      </section>

      {inSeason.length > 0 && (
        <section aria-labelledby="in-season" className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 id="in-season" className="text-[19px] font-semibold tracking-tight">
                Great in {MONTHS[month - 1]}
              </h2>
              <p className="mt-1 text-[13px] text-muted">In their best travel season this month, based on our destination guides.</p>
            </div>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            {inSeason.map((d) => (
              <Link
                key={d.id}
                href={`/plan?q=${encodeURIComponent(`I'd like to visit ${d.name} in ${MONTHS[month - 1]}`)}`}
                className="group relative block aspect-[16/9] overflow-hidden rounded-[22px] shadow-[0_18px_40px_-24px_rgba(23,21,47,0.6)]"
                aria-label={`Plan a trip to ${d.name} in ${MONTHS[month - 1]}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static local image */}
                <img src={d.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                <div className="absolute inset-0 bg-gradient-to-t from-nav-deep/90 via-nav-deep/30 to-transparent" aria-hidden />
                <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-lavender">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden /> In season
                  </p>
                  <p className="text-lg font-semibold">{d.name}</p>
                  <p className="line-clamp-1 text-xs text-white/80">{d.tagline}</p>
                  <p className="mt-2 flex items-center justify-between text-xs">
                    <span>from {formatMoney(d.fromPricePerPerson)} pp (est.)</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-ai px-2.5 py-1 font-semibold text-nav-deep">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden /> Plan <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Discover destinations={destinations} initialQuery={q} initialInterest={interest} title="All destinations" />
    </div>
  );
}
