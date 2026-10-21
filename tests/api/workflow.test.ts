import { beforeEach, describe, expect, it } from "vitest";
import { TestClient } from "../support/client";
import { resetRateLimits } from "@/lib/rate-limit";
import * as chat from "@/app/api/ai/chat/route";
import * as prefsStart from "@/app/api/trips/preferences/route";
import * as prefsById from "@/app/api/trips/preferences/[id]/route";
import * as generate from "@/app/api/itineraries/generate/route";
import * as itinerary from "@/app/api/itineraries/[id]/route";
import * as tripById from "@/app/api/trips/[id]/route";
import * as trips from "@/app/api/trips/route";
import * as handoff from "@/app/api/bookings/handoff/route";
import * as leads from "@/app/api/leads/route";
import * as leadById from "@/app/api/leads/[id]/route";
import * as tickets from "@/app/api/support/tickets/route";
import * as ticketById from "@/app/api/support/tickets/[id]/route";
import * as ticketMessages from "@/app/api/support/tickets/[id]/messages/route";
import * as overview from "@/app/api/dashboard/overview/route";
import * as login from "@/app/api/auth/login/route";

async function loginAs(email: string) {
  const c = new TestClient();
  const res = await c.call(login.POST, "POST", "/api/auth/login", { email, password: "demo1234" });
  expect(res.status).toBe(200);
  return c;
}

beforeEach(() => resetRateLimits());

describe("customer-to-business workflow (API)", () => {
  it("plans a trip, generates and edits an itinerary, creates a lead, ticket and dashboard updates", async () => {
    const customer = new TestClient();
    const sales = await loginAs("sales@pyt-demo.test");
    const support = await loginAs("support@pyt-demo.test");
    const before = await sales.call(overview.GET, "GET", "/api/dashboard/overview");
    expect(before.status).toBe(200);

    // 1. Start planning (anonymous) and describe the trip in one message.
    const start = await customer.call(prefsStart.POST, "POST", "/api/trips/preferences");
    expect(start.status).toBe(201);
    const tripId = start.body.trip.id as string;
    expect(customer.cookies.get("pyt_anon")).toBeTruthy();

    const t1 = await customer.call(chat.POST, "POST", "/api/ai/chat", {
      mode: "planner",
      tripId,
      message: "I want a five-day family trip to Bali in December",
      clientMessageId: "msg-0001-abc",
    });
    expect(t1.status).toBe(200);
    expect(t1.body.profile.destinationId).toBe("bali");
    expect(t1.body.profile.durationDays).toBe(5);
    expect(t1.body.profile.tripType).toBe("family");
    expect(t1.body.ai.source).toBe("rules"); // mock mode, no API key
    // It must not re-ask for destination or duration.
    expect(["destination", "duration"]).not.toContain(t1.body.turn.question.key);

    // Retrying the same client message is idempotent.
    const retry = await customer.call(chat.POST, "POST", "/api/ai/chat", {
      mode: "planner", tripId, message: "I want a five-day family trip to Bali in December", clientMessageId: "msg-0001-abc",
    });
    expect(retry.body.duplicate).toBe(true);

    for (const message of ["flexible", "2 adults and 2 kids aged 6 and 9", "from Chennai", "3 lakh total including flights"]) {
      const r = await customer.call(chat.POST, "POST", "/api/ai/chat", { mode: "planner", tripId, message });
      expect(r.status).toBe(200);
    }

    // Persistence: reload preferences from the server.
    const snap = await customer.call(prefsById.GET, "GET", `/api/trips/preferences/${tripId}`, undefined, { id: tripId });
    expect(snap.status).toBe(200);
    expect(snap.body.profile.adults).toBe(2);
    expect(snap.body.profile.children).toBe(2);
    expect(snap.body.profile.budgetAmount).toBe(300000);
    expect(snap.body.profile.departureCity).toBe("Chennai");
    expect(snap.body.messages.length).toBeGreaterThan(8);

    // A lead now exists for this trip.
    const leadList = await sales.call(leads.GET, "GET", "/api/leads?q=Website");
    const lead = leadList.body.items.find((l: { trip_id: string }) => l.trip_id === tripId);
    expect(lead).toBeTruthy();
    expect(lead.stage).toBe("new");

    // 2. Generate itinerary (deterministic in mock mode), then reuse it.
    const gen = await customer.call(generate.POST, "POST", "/api/itineraries/generate", { tripId });
    expect(gen.status).toBe(201);
    const it = gen.body.itinerary;
    expect(it.days).toHaveLength(5);
    expect(it.budget.total).toBeGreaterThan(0);
    const again = await customer.call(generate.POST, "POST", "/api/itineraries/generate", { tripId });
    expect(again.body.reused).toBe(true);

    // 3. Edit: replace an activity; budget recomputed.
    const activity = it.days.flatMap((d: { items: { kind: string; id: string }[] }) => d.items).find((i: { kind: string }) => i.kind === "activity");
    const edited = await customer.call(itinerary.PATCH, "PATCH", `/api/itineraries/${it.id}`, { op: "replace", itemId: activity.id }, { id: it.id });
    expect(edited.status).toBe(200);
    expect(edited.body.description).toMatch(/Replaced/);

    // 4. Save the trip with contact details.
    const saved = await customer.call(tripById.PATCH, "PATCH", `/api/trips/${tripId}`, { status: "saved", contact: { name: "Test Traveller", email: "traveller@example.com" } }, { id: tripId });
    expect(saved.status).toBe(200);
    expect(saved.body.trip.status).toBe("saved");

    // 5. Booking handoff requires explicit confirmation and is idempotent; never "booked".
    const noConfirm = await customer.call(handoff.POST, "POST", "/api/bookings/handoff", { tripId, contactName: "Test Traveller", contactEmail: "traveller@example.com", idempotencyKey: "idem-12345678" });
    expect(noConfirm.status).toBe(400);
    const h1 = await customer.call(handoff.POST, "POST", "/api/bookings/handoff", { tripId, contactName: "Test Traveller", contactEmail: "traveller@example.com", confirm: true, idempotencyKey: "idem-12345678" });
    expect(h1.status).toBe(201);
    expect(h1.body.handoff.provider_status).toBe("not_submitted");
    const h2 = await customer.call(handoff.POST, "POST", "/api/bookings/handoff", { tripId, contactName: "Test Traveller", contactEmail: "traveller@example.com", confirm: true, idempotencyKey: "idem-12345678" });
    expect(h2.body.duplicate).toBe(true);
    const tripAfter = await customer.call(tripById.GET, "GET", `/api/trips/${tripId}`, undefined, { id: tripId });
    expect(tripAfter.body.trip.status).toBe("handoff_requested");
    expect(tripAfter.body.lead).toBeUndefined(); // CRM data hidden from customers

    // The lead was updated with contact details and activities.
    const leadDetail = await sales.call(leadById.GET, "GET", `/api/leads/${lead.id}`, undefined, { id: lead.id });
    expect(leadDetail.body.lead.email).toBe("traveller@example.com");
    const types = leadDetail.body.activities.map((a: { type: string }) => a.type);
    expect(types).toEqual(expect.arrayContaining(["created", "itinerary_generated", "handoff_requested"]));

    // 6. Support ticket appears in support operations.
    const ticket = await customer.call(tickets.POST, "POST", "/api/support/tickets", { message: "Can I change my travel dates by a week?", tripId, idempotencyKey: "tkt-key-0001" });
    expect(ticket.status).toBe(201);
    expect(ticket.body.ticket.category).toBe("booking_change");
    const queue = await support.call(tickets.GET, "GET", `/api/support/tickets?scope=all&q=${ticket.body.ticket.ref}`);
    expect(queue.body.items.map((t: { id: string }) => t.id)).toContain(ticket.body.ticket.id);

    // Agent replies; status moves to in progress and first response is recorded.
    const reply = await support.call(ticketMessages.POST, "POST", "", { body: "Happy to help with new dates." }, { id: ticket.body.ticket.id });
    expect(reply.status).toBe(201);
    const t = await support.call(ticketById.GET, "GET", "", undefined, { id: ticket.body.ticket.id });
    expect(t.body.ticket.status).toBe("in_progress");
    expect(t.body.ticket.first_response_at).toBeTruthy();

    // Customer sees their ticket (and the reply), and their trips.
    const mine = await customer.call(tickets.GET, "GET", "/api/support/tickets");
    expect(mine.body.items).toHaveLength(1);
    const myTrips = await customer.call(trips.GET, "GET", "/api/trips");
    expect(myTrips.body.items.map((x: { id: string }) => x.id)).toContain(tripId);

    // 7. Dashboard metrics reflect the new records.
    const after = await sales.call(overview.GET, "GET", "/api/dashboard/overview");
    expect(after.body.kpis.newLeads).toBe(before.body.kpis.newLeads + 1);
    expect(after.body.kpis.openTickets).toBe(before.body.kpis.openTickets + 1);
    expect(after.body.kpis.bookingHandoffsOpen).toBe(before.body.kpis.bookingHandoffsOpen + 1);
  });
});
