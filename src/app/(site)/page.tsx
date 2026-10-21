import Link from "next/link";
import { ArrowRight, Calculator, Compass, Headphones, Mic, ShieldCheck, Sparkles } from "lucide-react";
import { listDestinationSummaries } from "@/lib/catalog/destinations";
import { getServerUser } from "@/lib/auth/server";
import { PlannerComposer } from "@/components/home/composer";
import { ContinuePanel } from "@/components/home/continue-panel";
import { Discover } from "@/components/home/discover";

const EXAMPLES = [
  { title: "Bali family escape", meta: "5 days · 2 adults, 2 kids · ₹3L", prompt: "A relaxed 5-day family trip to Bali in May with 2 kids aged 6 and 9, budget 3 lakh total", image: "/images/destinations/bali-card.jpg" },
  { title: "Maldives honeymoon", meta: "5 days · couple · luxury", prompt: "Honeymoon in the Maldives for 5 days in February, luxury overwater villa", image: "/images/destinations/maldives-card.jpg" },
  { title: "Dubai with friends", meta: "Long weekend · 4 friends", prompt: "Long weekend in Dubai with 4 friends in January, adventure and nightlife, from Mumbai", image: "/images/destinations/dubai-card.jpg" },
];

const VALUE = [
  { icon: Sparkles, title: "AI that remembers", body: "Say it once — the planner asks only for what's missing." },
  { icon: Calculator, title: "Transparent estimates", body: "Itemised costs, clearly marked as estimates, never fake live prices." },
  { icon: ShieldCheck, title: "Nothing booked without you", body: "You review everything and confirm before an expert quotes." },
  { icon: Headphones, title: "Human experts", body: "Travel experts check suppliers and handle every booking." },
];

export default async function HomePage() {
  const destinations = listDestinationSummaries();
  const user = await getServerUser();
  const first = user?.name.split(" ")[0];
  return (
    <>
      {/* Scenic banner with the AI trip prompt */}
      <section className="px-3 pt-4 sm:px-6 sm:pt-5">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[22px] bg-nav-deep shadow-[0_24px_60px_-30px_rgba(23,21,47,0.55)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static local banner image */}
          <img src="/images/destinations/maldives.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" />
          <div className="absolute inset-0 bg-gradient-to-r from-nav-deep/95 via-nav-deep/75 to-[#5b3fa0]/30" aria-hidden />
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-lavender/25 blur-3xl" aria-hidden />
          <div className="relative grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-10">
            <div>
              <p className="inline-flex items-center gap-1.5 rounded-full border border-lavender/40 bg-white/10 px-2.5 py-1 text-[12px] font-medium text-lavender backdrop-blur">
                <Compass className="h-3.5 w-3.5" aria-hidden /> {first ? `Welcome back, ${first}` : "AI travel planner"}
              </p>
              <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-tight text-white sm:text-[30px]">Where would you like to go next?</h1>
              <p className="mt-1.5 max-w-2xl text-[14px] text-white/80">
                Describe your trip once. The planner builds a day-by-day itinerary with transparent estimates, adjusts it when you ask, and hands it to a travel expert when you&apos;re ready.
              </p>
              <div className="mt-5">
                <PlannerComposer />
              </div>
            </div>
            <div className="hidden lg:block">
              <div className="mb-3 flex items-end gap-3">
                <picture>
                  <source srcSet="/images/robot/robot-512.webp" type="image/webp" />
                  <img src="/images/robot/robot-512.png" alt="Pickyourtrail AI travel assistant robot" width={96} height={144} className="h-36 w-auto drop-shadow-[0_12px_28px_rgba(203,179,235,0.45)]" />
                </picture>
                <div className="mb-4 rounded-2xl rounded-bl-md border border-white/20 bg-white/10 px-3 py-2 text-[13px] text-white backdrop-blur">
                  <p className="font-medium">Hi! Prefer to talk?</p>
                  <Link href="/plan?new=1&voice=1" className="mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-xl bg-ai px-3 text-xs font-semibold text-nav-deep hover:bg-ai-hover">
                    <Mic className="h-3.5 w-3.5" aria-hidden /> Plan by voice
                  </Link>
                </div>
              </div>
              <ContinuePanel />
            </div>
          </div>
        </div>
      </section>

      {/* Value strip */}
      <section aria-label="Why plan with Pickyourtrail" className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {VALUE.map((v) => (
            <li key={v.title} className="glass flex items-start gap-3 rounded-2xl p-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lavender-surface text-primary">
                <v.icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span>
                <span className="block text-[13px] font-semibold">{v.title}</span>
                <span className="block text-xs text-muted">{v.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:hidden">
        <ContinuePanel />
      </div>

      <Discover destinations={destinations} />

      <section className="mx-auto max-w-7xl px-4 pb-4 sm:px-6" aria-labelledby="examples">
        <h2 id="examples" className="text-[19px] font-semibold tracking-tight">
          Quick-start trip ideas
        </h2>
        <p className="mt-1 text-[13px] text-muted">Start from a sample request — you can change anything in the chat.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {EXAMPLES.map((e) => (
            <Link key={e.title} href={`/plan?q=${encodeURIComponent(e.prompt)}`} className="surface group flex gap-3 overflow-hidden rounded-2xl p-3 transition-colors hover:border-lavender">
              {/* eslint-disable-next-line @next/next/no-img-element -- static local thumbnail */}
              <img src={e.image} alt="" loading="lazy" className="h-20 w-24 shrink-0 rounded-xl object-cover" />
              <span className="min-w-0">
                <span className="block text-xs text-muted">{e.meta}</span>
                <span className="mt-0.5 block font-semibold">{e.title}</span>
                <span className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-primary">
                  Plan this <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
