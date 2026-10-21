"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "./ui";

const GRADIENTS = [
  "from-[#2a2552] to-[#8f74c4]",
  "from-[#19172f] to-[#cbb3eb]",
  "from-[#3b2f6b] to-[#b79be0]",
];

/** Smaller crop for cards (local catalog images ship a `-card` variant). */
export function cardImage(src: string | null | undefined) {
  return src && src.startsWith("/images/destinations/") ? src.replace(/\.jpg$/, "-card.jpg") : src;
}

/** Destination photo with a branded fallback if an image is missing. */
export function DestinationImage({ src, alt, className, seed = 0, eager, card }: { src?: string | null; alt: string; className?: string; seed?: number; eager?: boolean; card?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = card ? cardImage(src) : src;
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br", GRADIENTS[seed % GRADIENTS.length], className)}>
      {url && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- static local imagery with graceful fallback
        <img src={url} alt={alt} loading={eager ? "eager" : "lazy"} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {(failed || !url) && (
        <span className="absolute inset-0 flex items-center justify-center gap-1.5 text-sm font-semibold text-white/90">
          <MapPin className="h-4 w-4" aria-hidden /> {alt}
        </span>
      )}
    </div>
  );
}
