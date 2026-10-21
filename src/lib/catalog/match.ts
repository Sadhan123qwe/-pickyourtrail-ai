import { DESTINATIONS } from "./destinations";
import type { Destination } from "./types";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds the catalog destination mentioned earliest in free text. */
export function findDestinationInText(text: string): Destination | undefined {
  const lower = text.toLowerCase();
  let best: { d: Destination; index: number } | undefined;
  for (const d of DESTINATIONS) {
    for (const alias of d.aliases) {
      const m = new RegExp(`\\b${escapeRegex(alias)}\\b`).exec(lower);
      if (m && (!best || m.index < best.index)) best = { d, index: m.index };
    }
  }
  return best?.d;
}

/** Maps a destination name (from a customer or an LLM) to the catalog. */
export function matchDestination(name: string | null | undefined): Destination | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase().trim();
  return (
    DESTINATIONS.find((d) => d.id === lower || d.name.toLowerCase() === lower) ?? findDestinationInText(lower)
  );
}
