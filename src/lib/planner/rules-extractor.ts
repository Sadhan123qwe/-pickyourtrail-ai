import type { Interest } from "@/lib/catalog/types";
import { findDestinationInText } from "@/lib/catalog/match";
import { emptyExtraction, type ExtractionResult } from "./extraction";
import type { Currency, FieldKey, TripProfile } from "./profile";

/**
 * Deterministic, zero-cost preference extractor. Used in mock mode and as
 * the fallback when the AI provider fails. It understands common phrasings
 * ("5 day family trip to Bali in December", "₹1.5 lakh per person",
 * "2 adults and 2 kids aged 5 and 8") and short answers to the question that
 * was just asked ("Chennai", "4", "no").
 */

export interface RuleContext {
  lastQuestion: FieldKey | null;
  profile: TripProfile;
  today: Date;
}

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, couple: 2,
};
const NUM = "(\\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty)";

function toNum(token: string): number {
  const n = Number(token);
  return Number.isFinite(n) ? n : (WORD_NUM[token.toLowerCase()] ?? NaN);
}

const MONTH_RE =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthIndex(token: string): number {
  return MONTH_KEYS.indexOf(token.slice(0, 3).toLowerCase());
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Next occurrence (today or later) of a month/day, unless a year is given. */
function resolveYear(month: number, day: number | null, today: Date, year?: number): number {
  if (year) return year;
  const y = today.getFullYear();
  const m = today.getMonth();
  if (month > m) return y;
  if (month === m && (day === null || day >= today.getDate())) return y;
  return y + 1;
}

function isoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m, d));
  if (date.getUTCMonth() !== m || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

const DEPARTURE_CITIES: Record<string, string> = {
  chennai: "Chennai", madras: "Chennai", bengaluru: "Bengaluru", bangalore: "Bengaluru", mumbai: "Mumbai",
  bombay: "Mumbai", delhi: "Delhi", "new delhi": "Delhi", hyderabad: "Hyderabad", kolkata: "Kolkata",
  calcutta: "Kolkata", pune: "Pune", ahmedabad: "Ahmedabad", kochi: "Kochi", cochin: "Kochi",
  coimbatore: "Coimbatore", jaipur: "Jaipur", lucknow: "Lucknow", goa: "Goa", trivandrum: "Thiruvananthapuram",
  thiruvananthapuram: "Thiruvananthapuram", chandigarh: "Chandigarh", indore: "Indore", nagpur: "Nagpur",
  madurai: "Madurai", mangalore: "Mangaluru", mangaluru: "Mangaluru", visakhapatnam: "Visakhapatnam",
  vizag: "Visakhapatnam", bhubaneswar: "Bhubaneswar", guwahati: "Guwahati", trichy: "Tiruchirappalli",
  london: "London", "new york": "New York",
};

const INTEREST_KEYWORDS: [Interest, RegExp][] = [
  ["beaches", /\b(beach(es)?|island(s)?|snorkel\w*|sea ?side|ocean)\b/],
  ["culture", /\b(culture|cultural|temples?|museums?|local life|traditions?|traditional|art)\b/],
  ["adventure", /\b(adventure\w*|trek\w*|hik(e|es|ing)|rafting|div(e|ing)|scuba|skydiv\w*|zip ?lin\w*|thrill\w*|paraglid\w*)\b/],
  ["nature", /\b(nature|mountains?|scenic|scenery|waterfalls?|lakes?|forests?|hills?|national parks?|outdoors?)\b/],
  ["food", /\b(food|foodie|cuisine|eat(ing)?|culinary|street food|cooking)\b/],
  ["nightlife", /\b(nightlife|party|parties|clubs?|clubbing|bars?|pubs?)\b/],
  ["shopping", /\b(shop(ping)?|malls?|markets?|souvenirs?)\b/],
  ["wellness", /\b(spa|wellness|yoga|massage|detox)\b/],
  ["wildlife", /\b(wildlife|animals?|safari|zoo|dolphins?|elephants?|aquarium|marine life)\b/],
  ["history", /\b(history|historic(al)?|heritage|ruins|monuments?)\b/],
  ["family_fun", /\b(theme parks?|water ?parks?|disney\w*|universal studios|kids'? activities|amusement)\b/],
  ["romance", /\b(romantic|romance|candle ?light|couples?'? activities)\b/],
];

const UNKNOWN_RE =
  /\b(i\s*(don'?t|do not|dont)\s*know|not sure|no idea|undecided|haven'?t decided|not decided|unsure|tbd|yet to decide|i'?m flexible on that)\b/;
const RECOMMEND_RE =
  /\b(suggest|recommend\w*|surprise me|open to (ideas|suggestions|anything)|anywhere|you (choose|decide|pick)|ideas?)\b/;
const SKIP_RE = /^\s*(skip( this| it)?|pass|next( question)?|no preference|doesn'?t matter|any is fine|whatever)\s*[.!]*\s*$/;
const NONE_RE =
  /^\s*(no|none|nothing|nope|nah|nothing (specific|special|in particular)|no (special )?(requirements?|requests?|preferences?)|not really|n\/?a|all good|that'?s all)\s*[.!]*\s*$/;
const YES_RE = /^\s*(yes|yeah|yep|yup|sure|correct|it does|included|including|y)\b/;
const NO_RE = /^\s*(no|nope|nah|not included|excluding|it doesn'?t|n)\b/;
const GENERATE_RE =
  /\b(generate|create|build|make|show|prepare)\b.{0,20}\b(itinerary|plan|trip)\b|\b(go ahead|looks good|let'?s go|plan it|that'?s (it|all)|ready)\b/;

export function extractWithRules(message: string, ctx: RuleContext): ExtractionResult {
  const result = emptyExtraction();
  const raw = message.trim();
  const text = raw.toLowerCase().replace(/[’`]/g, "'");
  const u = result.updates;
  const q = ctx.lastQuestion;

  if (!text) return result;

  // --- Intent signals --------------------------------------------------
  result.wantsToGenerate = GENERATE_RE.test(text);
  const saysUnknown = UNKNOWN_RE.test(text);
  if (RECOMMEND_RE.test(text) || (saysUnknown && (q === "destination" || q === null) && !findDestinationInText(text))) {
    if (/\b(where|destination|place|go)\b/.test(text) || q === "destination" || RECOMMEND_RE.test(text)) {
      result.wantsRecommendations = true;
    }
  }

  // --- Destination -------------------------------------------------------
  const dest = findDestinationInText(text);
  if (dest) {
    u.destinationId = dest.id;
    u.destinationName = dest.name;
  } else if (q === "destination" && !saysUnknown && !result.wantsRecommendations && !SKIP_RE.test(text)) {
    // Unrecognised place name given as a direct answer.
    const cleaned = raw.replace(/^(to|i want to go to|let'?s go to|maybe|probably)\s+/i, "").replace(/[.!?]+$/, "");
    if (cleaned.length > 1 && cleaned.length <= 40 && !/\d/.test(cleaned)) u.destinationName = titleCase(cleaned);
  }

  // --- Duration ------------------------------------------------------------
  const daysMatch = new RegExp(`\\b${NUM}\\s*(?:-|\\s)?\\s*(days?|nights?|weeks?)\\b`).exec(text);
  if (daysMatch) {
    const n = toNum(daysMatch[1]);
    const unit = daysMatch[2];
    if (Number.isFinite(n) && n > 0) {
      const days = unit.startsWith("week") ? n * 7 : unit.startsWith("night") ? n + 1 : n;
      if (days >= 1 && days <= 60) u.durationDays = days;
    }
  } else if (/\b(long )?weekend\b/.test(text)) {
    u.durationDays = /long weekend/.test(text) ? 4 : 3;
  } else if (/\bfortnight\b/.test(text)) {
    u.durationDays = 14;
  } else if (q === "duration") {
    const bare = /^\s*(\d{1,2})\s*$/.exec(text);
    if (bare) u.durationDays = Math.min(60, Math.max(1, Number(bare[1])));
  }

  // --- Dates ---------------------------------------------------------------
  extractDates(text, ctx, result);

  // --- Travellers ------------------------------------------------------------
  extractTravellers(text, ctx, result);

  // --- Budget ----------------------------------------------------------------
  extractBudget(text, ctx, result);

  // --- Departure city ----------------------------------------------------------
  const fromMatch = /\b(?:from|out of|leaving|based in|live in|living in|depart(?:ing)? from|starting from)\s+([a-z][a-z ]{1,25})/.exec(text);
  if (fromMatch) {
    const city = lookupCity(fromMatch[1]);
    if (city) u.departureCity = city;
  }
  if (!u.departureCity && q === "departureCity" && !saysUnknown && !SKIP_RE.test(text)) {
    const city = lookupCity(text) ?? (text.length <= 30 && !/\d/.test(text) ? titleCase(raw.replace(/[.!]+$/, "")) : undefined);
    if (city) u.departureCity = city;
  }

  // --- Trip type & occasion ------------------------------------------------------
  if (/\bhoneymoon\b/.test(text)) u.tripType = "honeymoon";
  else if (/\b(family|kids|children)\b/.test(text) && !/\bno (kids|children)\b/.test(text)) {
    u.tripType = "family";
    if (!/\bfamily\b/.test(text)) (result.inferred ??= []).push("tripType"); // deduced from "kids"/"children"
  }
  else if (/\b(friends|buddies|gang|bachelor(ette)?|girls'? trip|boys'? trip)\b/.test(text)) u.tripType = "friends";
  else if (/\b(solo|alone|by myself|just me)\b/.test(text)) u.tripType = "solo";
  else if (/\b(business|work trip|conference|offsite)\b/.test(text)) u.tripType = "business";
  else if (/\b(couple|wife|husband|partner|spouse|girlfriend|boyfriend|anniversary|babymoon)\b/.test(text)) u.tripType = "couple";
  else if (q === "tripType" && /\b(group|team|office)\b/.test(text)) u.tripType = "group";
  const occasion = /\b(anniversary|birthday|babymoon|honeymoon|graduation|new year|christmas|diwali|bachelor(?:ette)? party|retirement)\b/.exec(text);
  if (occasion) u.occasion = titleCase(occasion[1]);
  if (!u.tripType && !u.occasion && q === "tripType" && !saysUnknown && !SKIP_RE.test(text) && raw.length <= 60) {
    u.occasion = raw.replace(/[.!]+$/, "");
  }

  // --- Interests ---------------------------------------------------------------
  const interests = INTEREST_KEYWORDS.filter(([, re]) => re.test(text)).map(([i]) => i);
  if (/\brelax(ing|ation)?\b/.test(text) && q === "interests") interests.push("wellness");
  if (interests.length) u.interests = Array.from(new Set([...(q === "interests" ? [] : ctx.profile.interests), ...interests]));

  // --- Pace ----------------------------------------------------------------------
  if (/\b(relaxed|slow[- ]paced|laid[- ]back|leisurely|not too (packed|hectic|rushed))\b/.test(text) || (q === "pace" && /\b(relax(ing)?|slow|chill(ed)?|leisure|easy[- ]going)\b/.test(text))) u.pace = "relaxed";
  else if (/\b(balanced|moderate|mix|bit of both|medium)\b/.test(text) && (q === "pace" || /\bpace\b/.test(text))) u.pace = "balanced";
  else if (/\b(packed|fast[- ]paced|action[- ]packed|see (it all|everything|as much as)|busy|hectic)\b/.test(text)) u.pace = "packed";
  else if (q === "pace" && /\brelax/.test(text)) u.pace = "relaxed";

  // --- Accommodation -----------------------------------------------------------
  if (/\b(5[- ]?star|five[- ]star|luxury|luxurious|overwater|private pool|villa)\b/.test(text)) u.accommodation = "luxury";
  else if (/\b(4[- ]?star|four[- ]star|mid[- ]?range|comfortable|comfort|standard|decent)\b/.test(text)) u.accommodation = "midrange";
  else if (/\b(3[- ]?star|three[- ]star|hostel|cheap|affordable|economical|basic)\b/.test(text) || (q === "accommodation" && /\bbudget\b/.test(text) && u.budgetAmount === undefined) || /\bbudget (hotel|stay|room)s?\b/.test(text)) u.accommodation = "budget";

  // --- Flights -------------------------------------------------------------------
  if (/\b(book(ing)? (the |our |my )?flights? (myself|ourselves|separately)|own flights?|already (have|booked) (the |our )?flights?|(don'?t|do not|no) need flights?|no flights?)\b/.test(text)) {
    u.needsFlights = false;
  } else if (/\bbusiness class\b/.test(text) || (q === "transport" && /\bbusiness\b/.test(text))) {
    u.needsFlights = true;
    u.flightClass = "business";
  } else if (/\bpremium economy\b/.test(text)) {
    u.needsFlights = true;
    u.flightClass = "premium_economy";
  } else if (/\beconomy\b/.test(text) || (q === "transport" && YES_RE.test(text))) {
    u.needsFlights = true;
    u.flightClass = "economy";
  }

  // --- Requirements ----------------------------------------------------------------
  const dietary = Array.from(
    text.matchAll(/\b(vegetarian|vegan|jain|halal|kosher|gluten[- ]free|nut allergy|lactose[- ]intolerant|eggetarian|pure veg|veg)\b/g),
  ).map((m) => (m[1] === "veg" || m[1] === "pure veg" ? "vegetarian" : m[1]));
  if (dietary.length) u.dietary = Array.from(new Set(dietary));
  const access = /\b(wheelchair|mobility|elderly|senior citizens?|walker|stroller|pram|accessible|knee problems?|can'?t walk (much|far))\b/.exec(text);
  if (access) u.accessibility = raw.length <= 200 ? raw : access[0];

  // --- Must-sees -------------------------------------------------------------------
  const mustSee = /\bmust[- ](see|visit|do)\s+(?:is |are )?(.+?)(?:[.!?]|$)/.exec(text);
  if (mustSee) u.mustSee = splitList(mustSee[2]);
  else if (q === "mustSee" && !NONE_RE.test(text) && !SKIP_RE.test(text) && !saysUnknown) {
    u.mustSee = splitList(raw.replace(/[.!]+$/, ""));
  }
  if (q === "requirements" && !NONE_RE.test(text) && !SKIP_RE.test(text) && !u.dietary && !u.accessibility && !saysUnknown) {
    u.specialRequests = raw.slice(0, 300);
  }

  // --- Short answers to the question just asked ------------------------------------
  if (q === "budgetIncludesFlights" && u.budgetIncludesFlights === undefined) {
    if (YES_RE.test(text)) u.budgetIncludesFlights = true;
    else if (NO_RE.test(text)) u.budgetIncludesFlights = false;
  }
  if (q && SKIP_RE.test(text)) result.resolved.push({ field: q, status: "skipped" });
  else if (q && NONE_RE.test(text) && ["requirements", "mustSee", "interests", "tripType", "pace"].includes(q)) {
    result.resolved.push({ field: q, status: q === "requirements" || q === "mustSee" ? "none" : "skipped" });
  } else if (q && saysUnknown && !result.wantsRecommendations && Object.keys(u).length === 0) {
    result.resolved.push({ field: q, status: "unknown" });
  }

  // --- Side questions --------------------------------------------------------------
  if (/\?\s*$/.test(raw) && Object.keys(u).length === 0 && !result.wantsRecommendations) {
    result.sideQuestion = raw.slice(0, 300);
  }

  return result;
}

function extractDates(text: string, ctx: RuleContext, result: ExtractionResult) {
  const u = result.updates;
  const dates: string[] = [];

  const iso = Array.from(text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g));
  for (const m of iso) {
    const d = isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d) dates.push(d);
  }

  if (!dates.length) {
    const ord = "(?:st|nd|rd|th)?";
    // "20-27 Dec", "20 to 27 december 2026"
    const rangeA = new RegExp(`\\b(\\d{1,2})${ord}\\s*(?:-|–|to|till|until)\\s*(\\d{1,2})${ord}\\s+(?:of\\s+)?${MONTH_RE}\\b(?:\\s+(\\d{4}))?`).exec(text);
    // "Dec 20-27"
    const rangeB = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})${ord}\\s*(?:-|–|to|till|until)\\s*(\\d{1,2})${ord}\\b(?:,?\\s+(\\d{4}))?`).exec(text);
    if (rangeA) {
      const m = monthIndex(rangeA[3]);
      const y = resolveYear(m, Number(rangeA[1]), ctx.today, rangeA[4] ? Number(rangeA[4]) : undefined);
      const a = isoDate(y, m, Number(rangeA[1]));
      const b = isoDate(y, m, Number(rangeA[2]));
      if (a && b) dates.push(a, b);
    } else if (rangeB) {
      const m = monthIndex(rangeB[1]);
      const y = resolveYear(m, Number(rangeB[2]), ctx.today, rangeB[4] ? Number(rangeB[4]) : undefined);
      const a = isoDate(y, m, Number(rangeB[2]));
      const b = isoDate(y, m, Number(rangeB[3]));
      if (a && b) dates.push(a, b);
    } else {
      // Individual dates: "20 Dec", "December 27th"
      const single = new RegExp(
        `\\b(?:(\\d{1,2})${ord}\\s+(?:of\\s+)?${MONTH_RE}|${MONTH_RE}\\s+(\\d{1,2})${ord})\\b(?:,?\\s+(\\d{4}))?`,
        "g",
      );
      for (const m of text.matchAll(single)) {
        const day = Number(m[1] ?? m[4]);
        const month = monthIndex(m[2] ?? m[3]);
        const y = resolveYear(month, day, ctx.today, m[5] ? Number(m[5]) : undefined);
        const d = isoDate(y, month, day);
        if (d) dates.push(d);
        if (dates.length === 2) break;
      }
    }
  }

  if (dates.length >= 2) {
    const [a, b] = dates[0] <= dates[1] ? [dates[0], dates[1]] : [dates[1], dates[0]];
    u.startDate = a;
    u.endDate = b;
    u.travelMonth = a.slice(0, 7);
  } else if (dates.length === 1) {
    u.startDate = dates[0];
    u.travelMonth = dates[0].slice(0, 7);
    const days = u.durationDays ?? ctx.profile.durationDays;
    if (days) u.endDate = addDays(dates[0], days - 1);
  } else {
    // Month only: "in December", "this dec", "December 2026". Bare "may" needs context.
    const monthOnly = new RegExp(`\\b(?:(in|during|around|this|next|early|mid|late|end of|by)\\s+)?${MONTH_RE}\\b(?:\\s+(\\d{4}))?`).exec(text);
    if (monthOnly && (monthOnly[2] !== "may" || monthOnly[1] || monthOnly[3] || ctx.lastQuestion === "dates")) {
      const m = monthIndex(monthOnly[2]);
      const y = resolveYear(m, null, ctx.today, monthOnly[3] ? Number(monthOnly[3]) : undefined);
      u.travelMonth = `${y}-${pad(m + 1)}`;
      u.startDate = null;
      u.endDate = null;
    } else if (/\bnext month\b/.test(text)) {
      const d = new Date(ctx.today.getFullYear(), ctx.today.getMonth() + 1, 1);
      u.travelMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    } else if (/\bthis month\b/.test(text)) {
      u.travelMonth = `${ctx.today.getFullYear()}-${pad(ctx.today.getMonth() + 1)}`;
    }
  }

  if (/\b(flexible|flexi|any ?time|open dates|dates are open|whenever)\b/.test(text)) u.dateFlexibility = "flexible";
  else if (/(±|\+\/-|plus or minus|give or take|few days (either|either way|flex)|a few days)/.test(text)) u.dateFlexibility = "few_days";
  else if (/\b(fixed|exact|specific dates|can'?t change|cannot change|locked)\b/.test(text)) u.dateFlexibility = "fixed";
  else if (u.startDate && u.endDate) u.dateFlexibility = "fixed";
}

function extractTravellers(text: string, ctx: RuleContext, result: ExtractionResult) {
  const u = result.updates;
  const kids = new RegExp(`\\b${NUM}\\s*(kids?|children|child|toddlers?|infants?|bab(?:y|ies)|sons?|daughters?)\\b`).exec(text);
  const adults = new RegExp(`\\b${NUM}\\s*(adults?|grown[- ]?ups)\\b`).exec(text);
  const people = new RegExp(`\\b${NUM}\\s*(people|persons|pax|travell?ers|of us|members|friends|guests)\\b`).exec(text);
  const familyOf = new RegExp(`\\bfamily of\\s*${NUM}\\b`).exec(text);
  const weAre = new RegExp(`\\bwe(?:'re| are)\\s*${NUM}\\b`).exec(text);

  if (kids) {
    const n = toNum(kids[1]);
    if (Number.isFinite(n)) u.children = n;
  } else if (/\b(no kids|no children|just adults|adults only)\b/.test(text)) {
    u.children = 0;
  } else if (/\b(a|our|my) (kid|child|son|daughter|baby|toddler)\b/.test(text)) {
    u.children = 1;
  } else if (/\b(the|our|my) (kids|children)\b/.test(text) && ctx.profile.children === null) {
    // Children mentioned without a count; leave the count to a follow-up question.
  }

  if (adults) {
    const n = toNum(adults[1]);
    if (Number.isFinite(n) && n >= 1) u.adults = n;
  } else if (familyOf) {
    const total = toNum(familyOf[1]);
    if (Number.isFinite(total) && total >= 2) {
      const children = u.children ?? (total > 2 ? total - 2 : 0);
      u.adults = Math.max(1, total - children);
      u.children = children;
    }
  } else if (people || weAre) {
    const total = toNum((people ?? weAre)![1]);
    if (Number.isFinite(total) && total >= 1) {
      const includesKids = u.children !== undefined && /\b(including|incl|of which|with)\b/.test(text);
      u.adults = includesKids ? Math.max(1, total - (u.children ?? 0)) : total;
    }
  } else if (/\b(solo|alone|by myself|just me)\b/.test(text)) {
    u.adults = 1;
  } else if (/\b(honeymoon|couple|my (wife|husband|partner|spouse|girlfriend|boyfriend|fianc[eé]e?)|two of us|me and my (wife|husband|partner))\b/.test(text)) {
    u.adults = 2;
  } else if (ctx.lastQuestion === "travellers") {
    const bare = /^\s*(\d{1,2})\s*$/.exec(text);
    if (bare) u.adults = Number(bare[1]);
  }

  if (u.adults !== undefined && u.children === undefined && ctx.profile.children === null) {
    // An adult count with no mention of children means none, unless it is a family trip.
    if (!/\b(family|kids|children)\b/.test(text) && ctx.profile.tripType !== "family") u.children = 0;
  }

  // Children's ages: "ages 5 and 8", "aged 4, 7", "5 and 8 years old", "a 6 year old"
  const agesCue = /\b(ages?|aged|years?|yrs?|y\/?o|year[- ]olds?)\b/.test(text);
  if (agesCue || ctx.lastQuestion === "childrenAges") {
    // Only the list directly after "ages"/"aged" ("aged 6 and 9, budget 3 lakh" → 6, 9), so later numbers
    // such as budgets or durations are never mistaken for ages.
    const list = /\b(?:ages?|aged)\b(?:\s*(?:of|are|is|:))?\s*((?:\d{1,2}(?:\s*(?:,|and|&|\/)\s*|\s+(?=\d)))*\d{1,2})(?!\s*(?:lakh|lac|k\b|days?|nights?|weeks?|%))/.exec(text)?.[1];
    const segment = list ?? text.replace(/\d[\d,.]*\s*(?:lakhs?|lacs?|k|thousand|days?|nights?|weeks?|adults?|people|pax)\b/g, " ");
    const nums = Array.from(segment.matchAll(/\b(\d{1,2})\b/g))
      .map((m) => Number(m[1]))
      .filter((n) => n <= 17);
    const yearsOld = Array.from(text.matchAll(/\b(\d{1,2})[- ]?(?:years?|yrs?|y\/?o|year[- ]olds?)\b/g)).map((m) => Number(m[1]));
    const ages = (/\b(ages?|aged)\b/.test(text) || ctx.lastQuestion === "childrenAges" ? nums : yearsOld).filter((n) => n <= 17);
    if (ages.length) {
      u.childrenAges = ages.slice(0, 20);
      if (u.children === undefined && (ctx.profile.children === null || ctx.profile.children === 0)) u.children = ages.length;
    }
  }
}

function extractBudget(text: string, ctx: RuleContext, result: ExtractionResult) {
  const u = result.updates;
  const re =
    /(₹|rs\.?|inr|\$|usd|us\$|€|eur|aed|£|gbp|sgd|s\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr|m|million)?\b\s*(inr|rupees?|rs|usd|dollars?|eur|euros?|aed|dirhams?|gbp|pounds?|sgd)?/g;
  const hasBudgetWord = /\b(budget|spend|spending|afford|cost|under|within|max(imum)?|around|about|upto|up to)\b/.test(text);
  for (const m of text.matchAll(re)) {
    const [, pre, numStr, mag, post] = m;
    const n = Number(numStr.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) continue;
    // Skip numbers that are clearly days/people/dates/ages.
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 14);
    if (!pre && !mag && !post && /^\s*(days?|nights?|weeks?|adults?|kids?|children|people|pax|years?|yrs|of us|friends|star)/.test(after)) continue;
    // Skip years ("December 2026") and ISO dates.
    if (!pre && !mag && !post && ((n >= 1900 && n <= 2100 && !numStr.includes(",")) || after.startsWith("-"))) continue;
    const multiplier = !mag
      ? 1
      : /^k|thousand/.test(mag)
        ? 1_000
        : /^(l|lakh|lac)/.test(mag)
          ? 100_000
          : /^(cr|crore)/.test(mag)
            ? 10_000_000
            : 1_000_000;
    const amount = Math.round(n * multiplier);
    const currency = detectCurrency(pre, post);
    const plausible = amount >= 1000 || (currency !== null && currency !== "INR" && amount >= 100);
    if (!plausible) continue;
    if (!(pre || post || mag || hasBudgetWord || ctx.lastQuestion === "budget")) continue;
    u.budgetAmount = amount;
    u.currency = currency ?? (mag && /^(l|lakh|lac|cr|crore)/.test(mag) ? "INR" : ctx.profile.currency);
    break;
  }
  if (/\b(per (person|head|pax|adult)|each|pp|a head)\b/.test(text)) u.budgetScope = "per_person";
  else if (/\b(total|overall|in all|altogether|for (all|everyone|the family|us|the whole))\b/.test(text)) u.budgetScope = "total";

  if (/\b(incl(uding|udes|usive of)?|with)\s+(the\s+)?(flights?|air ?fares?|air ?tickets?|tickets)\b/.test(text)) u.budgetIncludesFlights = true;
  else if (/\b(excl(uding|udes)?|without|not including|minus|plus|apart from)\s+(the\s+)?(flights?|air ?fares?|air ?tickets?)\b/.test(text)) u.budgetIncludesFlights = false;
}

function detectCurrency(pre?: string, post?: string): Currency | null {
  const token = `${pre ?? ""} ${post ?? ""}`.toLowerCase();
  if (/₹|rs|inr|rupee/.test(token)) return "INR";
  if (/s\$|sgd/.test(token)) return "SGD";
  if (/\$|usd|dollar/.test(token)) return "USD";
  if (/€|eur/.test(token)) return "EUR";
  if (/£|gbp|pound/.test(token)) return "GBP";
  if (/aed|dirham/.test(token)) return "AED";
  return null;
}

function lookupCity(fragment: string): string | undefined {
  const f = fragment.toLowerCase();
  for (const [key, name] of Object.entries(DEPARTURE_CITIES)) {
    if (new RegExp(`^\\s*${key}\\b`).test(f) || new RegExp(`\\b${key}\\b`).test(f.split(/\b(to|in|on|for|with|and)\b/)[0])) {
      return name;
    }
  }
  return undefined;
}

function splitList(s: string): string[] {
  return s
    .split(/,|\band\b|&|\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1)
    .map((x) => x.slice(0, 80))
    .slice(0, 10);
}

function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}
