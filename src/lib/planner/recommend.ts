import { DESTINATIONS } from "@/lib/catalog/destinations";
import { INTEREST_LABELS, type Destination } from "@/lib/catalog/types";
import { DEMO_FX_TO_INR, totalTravellers, type TripProfile } from "./profile";

export interface DestinationRecommendation {
  id: string;
  name: string;
  image: string;
  tagline: string;
  score: number;
  reasons: string[];
  estimatedPerPerson: number;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Rough per-person estimate (INR) for a destination given the profile. */
export function roughPerPersonCost(d: Destination, p: TripProfile): number {
  const days = p.durationDays ?? d.idealDays[0];
  const nights = Math.max(days - 1, 1);
  const tier = p.accommodation ?? "midrange";
  const rate = d.hotels.find((h) => h.tier === tier)?.nightlyRate ?? d.hotels[1].nightlyRate;
  const flights = p.needsFlights === false ? 0 : d.flightEconomyPerPerson;
  const activities = d.activities.slice(0, Math.min(days, d.activities.length)).reduce((s, a) => s + a.costPerPerson, 0) * 0.6;
  return Math.round(flights + (rate * nights) / 2 + d.mealsPerPersonPerDay * days + (d.localTransportPerDay * days) / 2 + activities);
}

/** Deterministic destination scoring: no AI call needed. */
export function recommendDestinations(p: TripProfile, limit = 3): DestinationRecommendation[] {
  const month = p.startDate ? Number(p.startDate.slice(5, 7)) : p.travelMonth ? Number(p.travelMonth.slice(5, 7)) : null;
  const travellers = totalTravellers(p);
  const budgetPerPersonInr =
    p.budgetAmount !== null
      ? (p.budgetAmount * DEMO_FX_TO_INR[p.currency]) / (p.budgetScope === "per_person" ? 1 : travellers)
      : null;

  return DESTINATIONS.map((d) => {
    let score = 0;
    const reasons: string[] = [];
    const matched = p.interests.filter((i) => d.interests.includes(i));
    if (matched.length) {
      score += matched.length * 3;
      reasons.push(`Great for ${matched.map((i) => INTEREST_LABELS[i].toLowerCase()).slice(0, 3).join(", ")}`);
    }
    if (month) {
      if (d.bestMonths.includes(month)) {
        score += 3;
        reasons.push(`${MONTH_NAMES[month - 1]} is a good time to visit`);
      } else {
        score -= 2;
      }
    }
    const est = roughPerPersonCost(d, p);
    if (budgetPerPersonInr !== null) {
      if (est <= budgetPerPersonInr) {
        score += 3;
        reasons.push("Fits your budget (estimate)");
      } else if (est <= budgetPerPersonInr * 1.2) {
        score += 1;
        reasons.push("Close to your budget (estimate)");
      } else {
        score -= 3;
      }
    }
    if ((p.children ?? 0) > 0) {
      const kidFriendly = d.activities.filter((a) => a.kidFriendly).length;
      if (kidFriendly >= 8) {
        score += 2;
        reasons.push("Plenty of kid-friendly activities");
      }
    }
    if (p.tripType === "honeymoon" || p.tripType === "couple") {
      if (d.interests.includes("romance")) {
        score += 2;
        reasons.push("Popular with couples");
      }
    }
    if (p.durationDays) {
      if (p.durationDays >= d.idealDays[0] && p.durationDays <= d.idealDays[1] + 2) score += 1;
      else if (p.durationDays < d.idealDays[0] - 1) score -= 1;
    }
    if (!reasons.length) reasons.push(d.tagline);
    return { id: d.id, name: d.name, image: d.image, tagline: d.tagline, score, reasons, estimatedPerPerson: est };
  })
    .sort((a, b) => b.score - a.score || a.estimatedPerPerson - b.estimatedPerPerson)
    .slice(0, limit);
}
