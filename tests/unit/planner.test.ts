import { describe, expect, it } from "vitest";
import { extractWithRules } from "@/lib/planner/rules-extractor";
import { fromLlmExtraction, LlmExtractionSchema } from "@/lib/planner/extraction";
import { emptyProfile, essentialsResolved } from "@/lib/planner/profile";
import { fieldForQuestion, initialTurn, processTurn, type PlannerState, type TurnResult } from "@/lib/planner/engine";

const today = new Date("2026-10-19T10:00:00Z");

function conversation() {
  let state: PlannerState = initialTurn().state;
  const asked: string[] = [];
  const say = (message: string): TurnResult => {
    const extraction = extractWithRules(message, { lastQuestion: fieldForQuestion(state.lastQuestion), profile: state.profile, today });
    const turn = processTurn(state, extraction, message, today);
    state = turn.state;
    if (turn.question) asked.push(turn.question.key);
    return turn;
  };
  return { say, get state() { return state; }, asked };
}

describe("rule-based preference extraction", () => {
  it("understands the brief's example in one sentence", () => {
    const r = extractWithRules("I want a five-day family trip to Bali in December.", { lastQuestion: "destination", profile: emptyProfile(), today });
    expect(r.updates).toMatchObject({ destinationId: "bali", durationDays: 5, travelMonth: "2026-12", tripType: "family" });
  });

  it.each([
    ["₹1.5 lakh per person", 150000, "INR", "per_person"],
    ["budget 2L total", 200000, "INR", "total"],
    ["around 150k", 150000, "INR", undefined],
    ["$3000 for everyone", 3000, "USD", "total"],
    ["1,50,000 rupees", 150000, "INR", undefined],
  ])("parses budget %s", (text, amount, currency, scope) => {
    const r = extractWithRules(text, { lastQuestion: "budget", profile: emptyProfile(), today });
    expect(r.updates.budgetAmount).toBe(amount);
    expect(r.updates.currency).toBe(currency);
    expect(r.updates.budgetScope).toBe(scope);
  });

  it("does not mistake a year or a day count for a budget", () => {
    const r = extractWithRules("7 days in December 2026 with my budget to be decided", { lastQuestion: null, profile: emptyProfile(), today });
    expect(r.updates.budgetAmount).toBeUndefined();
    expect(r.updates.durationDays).toBe(7);
    expect(r.updates.travelMonth).toBe("2026-12");
  });

  it("parses exact date ranges and travellers with children's ages", () => {
    const r = extractWithRules("Dec 20-27, 2 adults and 2 kids aged 5 and 8", { lastQuestion: null, profile: emptyProfile(), today });
    expect(r.updates).toMatchObject({ startDate: "2026-12-20", endDate: "2026-12-27", adults: 2, children: 2, childrenAges: [5, 8], dateFlexibility: "fixed" });
  });

  it("treats a bare answer according to the question just asked", () => {
    expect(extractWithRules("Chennai", { lastQuestion: "departureCity", profile: emptyProfile(), today }).updates.departureCity).toBe("Chennai");
    expect(extractWithRules("4", { lastQuestion: "travellers", profile: emptyProfile(), today }).updates.adults).toBe(4);
    expect(extractWithRules("no", { lastQuestion: "budgetIncludesFlights", profile: emptyProfile(), today }).updates.budgetIncludesFlights).toBe(false);
  });

  it("supports 'I don't know yet' and skipping", () => {
    expect(extractWithRules("I don't know yet", { lastQuestion: "dates", profile: emptyProfile(), today }).resolved).toEqual([{ field: "dates", status: "unknown" }]);
    expect(extractWithRules("skip", { lastQuestion: "pace", profile: emptyProfile(), today }).resolved).toEqual([{ field: "pace", status: "skipped" }]);
    expect(extractWithRules("None", { lastQuestion: "requirements", profile: emptyProfile(), today }).resolved).toEqual([{ field: "requirements", status: "none" }]);
  });

  it("converts structured LLM output and drops invalid values", () => {
    const raw = LlmExtractionSchema.parse({
      destination: "Bali", wantsRecommendations: false, departureCity: null, startDate: "not-a-date", endDate: null, travelMonth: "2026-12",
      dateFlexibility: null, durationDays: 500, adults: 2, children: 0, childrenAges: [30, 4], tripType: "family", occasion: null,
      interests: ["beaches"], pace: null, budgetAmount: 150000.4, currency: "INR", budgetScope: "total", budgetIncludesFlights: null,
      accommodation: null, needsFlights: null, flightClass: null, dietary: null, accessibility: null, mustSee: null, specialRequests: null,
      unknownFields: ["pace"], noneFields: [], skippedFields: [], wantsToGenerate: false, sideQuestion: null, sideAnswer: null,
    });
    const r = fromLlmExtraction(raw);
    expect(r.updates.destinationName).toBe("Bali");
    expect(r.updates.startDate).toBeUndefined();
    expect(r.updates.durationDays).toBeUndefined();
    expect(r.updates.childrenAges).toEqual([4]);
    expect(r.updates.budgetAmount).toBe(150000);
    expect(r.resolved).toEqual([{ field: "pace", status: "unknown" }]);
  });
});

describe("adaptive conversation engine", () => {
  it("never re-asks answered questions and reaches review", () => {
    const c = conversation();
    const first = c.say("I want a five-day family trip to Bali in December");
    expect(first.question?.key).toBe("dates"); // asks for date flexibility, not destination/duration
    for (const m of ["flexible", "2 adults and 2 kids aged 5 and 8", "3 lakh total", "yes", "from Chennai", "beaches and food", "relaxed", "4 star", "economy", "vegetarian", "nothing specific"]) {
      c.say(m);
    }
    expect(c.asked).not.toContain("destination");
    expect(c.asked).not.toContain("duration");
    expect(c.asked).not.toContain("tripType"); // inferred from "family"
    expect(new Set(c.asked).size).toBe(c.asked.length); // no question asked twice
    expect(c.state.lastQuestion).toBe("review");
    expect(c.say("yes, generate it").stage).toBe("ready");
  });

  it("only asks for children's ages when children are travelling", () => {
    const c = conversation();
    c.say("Honeymoon in the Maldives for 5 days in February");
    expect(c.state.profile.adults).toBe(2);
    expect(c.asked).not.toContain("childrenAges");
    expect(c.asked).not.toContain("travellers");
  });

  it("lets customers correct earlier answers", () => {
    const c = conversation();
    c.say("5 days in Dubai");
    const t = c.say("actually make it 7 days");
    expect(c.state.profile.durationDays).toBe(7);
    expect(t.reply).toMatch(/Updated duration to 7 days/);
  });

  it("asks a clarifying question when dates and duration conflict, then resolves it", () => {
    const c = conversation();
    c.say("Bali from Dec 20 to Dec 27");
    const t = c.say("5 days");
    expect(t.question?.key).toBe("conflict:duration");
    c.say("5 days");
    expect(c.state.profile.endDate).toBe("2026-12-24");
    expect(c.state.lastQuestion).not.toBe("conflict:duration");
  });

  it("does not block exploratory users without a destination", () => {
    const c = conversation();
    const t = c.say("I'm not sure where to go, suggest something");
    expect(c.state.profile.destinationOpen).toBe(true);
    expect(t.question?.key).toBe("duration");
    c.say("6 days");
    c.say("I don't know yet"); // dates
    c.say("2 adults");
    const recTurn = c.say("2 lakh total");
    const destTurn = recTurn.question?.key === "interests" ? c.say("beaches") : recTurn;
    expect(destTurn.question?.key).toBe("destination");
    expect(destTurn.recommendations.length).toBe(3);
    c.say(destTurn.recommendations[0].name);
    expect(c.state.profile.destinationId).toBe(destTurn.recommendations[0].id);
  });

  it("is honest about destinations outside the demo catalog", () => {
    const c = conversation();
    const t = c.say("Iceland");
    expect(t.reply).toMatch(/don't have detailed demo content for \*\*Iceland\*\*/);
    expect(c.state.profile.destinationId).toBeNull();
  });

  it("clears dates in the past", () => {
    const c = conversation();
    const t = c.say("Bali on 2025-01-05 for 4 days");
    expect(t.reply).toMatch(/already passed/);
    expect(c.state.profile.startDate).toBeNull();
  });

  it("knows when essentials are resolved even with unknowns", () => {
    const c = conversation();
    c.say("Singapore for 4 days");
    c.say("I don't know yet"); // dates
    c.say("3 adults");
    expect(essentialsResolved(c.state.profile, c.state.status)).toBe(false);
    c.say("not sure"); // budget
    expect(essentialsResolved(c.state.profile, c.state.status)).toBe(true);
  });
});

describe("unparseable answers", () => {
  it("skips an optional question instead of asking it again, but re-asks essential ones", () => {
    const c = conversation();
    c.say("A relaxed 5-day family trip to Bali in December, 2 adults and 2 kids aged 6 and 9, budget 3 lakh total, from Mumbai");
    let t = c.say("flexible");
    expect(c.state.lastQuestion).toBe("budgetIncludesFlights");
    t = c.say("qwerty zxcv");
    expect(t.reply).toMatch(/I'll leave it for now/);
    expect(t.question?.key).not.toBe("budgetIncludesFlights");
    expect(c.state.status.budgetIncludesFlights).toBe("skipped");

    const d = conversation();
    d.say("hello");
    const again = d.say("qwerty zxcv");
    expect(again.reply).not.toMatch(/I'll leave it for now/);
    expect(again.question?.key).toBe("destination");
    expect(d.state.status.destination).toBeUndefined();
  });
});

describe("the redesign brief's example request", () => {
  it("captures everything in one sentence and never re-asks it", () => {
    const c = conversation();
    const t = c.say("Plan a five-day family trip to Bali in December for two adults and two children. Our total budget is ₹1.5 lakh.");
    expect(c.state.profile).toMatchObject({ destinationId: "bali", durationDays: 5, travelMonth: "2026-12", tripType: "family", adults: 2, children: 2, budgetAmount: 150000, budgetScope: "total" });
    expect(["destination", "duration", "travellers", "budget", "tripType"]).not.toContain(t.question?.key);
    // A dates follow-up may only refine the month already given, never ask "when?" again.
    if (t.question?.key === "dates") expect(t.question.text).toMatch(/Dec 2026/);
  });
});
