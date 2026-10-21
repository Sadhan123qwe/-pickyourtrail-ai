"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Mic, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";

const EXAMPLES = [
  "A 5-day family trip to Bali in December",
  "Honeymoon in the Maldives in February, luxury",
  "Long weekend in Dubai with 4 friends from Mumbai",
  "Not sure where to go — beaches, budget ₹1.5 lakh per person",
];

/** The primary customer entry point: describe the trip in your own words. */
export function PlannerComposer() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (text: string) => router.push(text.trim() ? `/plan?q=${encodeURIComponent(text.trim())}` : "/plan");
  return (
    <div className="rounded-[18px] border border-white/60 bg-surface/95 p-4 shadow-[0_18px_40px_-20px_rgba(23,21,47,0.6)] backdrop-blur">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <label htmlFor="home-composer" className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-ai text-nav-deep"><Sparkles className="h-3.5 w-3.5" aria-hidden /></span> Describe your trip — the AI planner asks only for what&apos;s missing
        </label>
        <textarea
          id="home-composer"
          rows={3}
          maxLength={400}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              go(q);
            }
          }}
          placeholder="e.g. A relaxed 6-day trip to Japan in April for two, around ₹3 lakh, we love food and temples"
          className="mt-3 w-full resize-none rounded-xl border border-border bg-lavender-surface/40 px-4 py-3 text-[15px] placeholder:text-slate-400 focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => router.push("/plan?new=1&voice=1")} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-muted hover:text-foreground">
            <Mic className="h-3.5 w-3.5" aria-hidden /> Prefer to speak? Plan by voice with the AI robot
          </button>
          <Button type="submit" size="lg" variant="ai">
            Plan with AI <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="text-xs font-medium text-muted">Quick start:</span>
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => go(e)} className="rounded-full border border-lavender/70 bg-surface px-3 py-1 text-xs text-foreground hover:bg-lavender-surface">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
