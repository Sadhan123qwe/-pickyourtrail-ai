export const INTERESTS = [
  "beaches",
  "culture",
  "adventure",
  "nature",
  "food",
  "nightlife",
  "shopping",
  "wellness",
  "wildlife",
  "history",
  "family_fun",
  "romance",
] as const;
export type Interest = (typeof INTERESTS)[number];

export const INTEREST_LABELS: Record<Interest, string> = {
  beaches: "Beaches",
  culture: "Culture",
  adventure: "Adventure",
  nature: "Nature",
  food: "Food",
  nightlife: "Nightlife",
  shopping: "Shopping",
  wellness: "Wellness & spa",
  wildlife: "Wildlife",
  history: "History",
  family_fun: "Family fun",
  romance: "Romance",
};

export type HotelTier = "budget" | "midrange" | "luxury";

export interface CatalogActivity {
  id: string;
  title: string;
  area: string;
  tags: Interest[];
  hours: number;
  /** Estimated adult price per person in INR (demo data). */
  costPerPerson: number;
  /** Estimated child price per person in INR; defaults to 70% of adult. */
  childCost?: number;
  kidFriendly: boolean;
  intensity: "easy" | "moderate" | "active";
  description: string;
}

export interface HotelOption {
  tier: HotelTier;
  name: string;
  area: string;
  /** Estimated nightly rate per room in INR (demo data). */
  nightlyRate: number;
  highlights: string;
}

export interface Destination {
  id: string;
  name: string;
  country: string;
  aliases: string[];
  image: string;
  tagline: string;
  description: string;
  bestMonths: number[];
  interests: Interest[];
  idealDays: [number, number];
  /** Estimated return economy airfare per person from major Indian cities, INR. */
  flightEconomyPerPerson: number;
  arrivalAirport: string;
  /** Estimated private transfers and local transport per day for a group, INR. */
  localTransportPerDay: number;
  /** Estimated meals per person per day, INR. */
  mealsPerPersonPerDay: number;
  visaNote: string;
  hotels: HotelOption[];
  activities: CatalogActivity[];
}
