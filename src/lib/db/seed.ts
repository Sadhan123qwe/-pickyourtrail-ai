import { randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth/password";
import { DESTINATIONS } from "@/lib/catalog/destinations";
import { buildItinerary, planDaysDeterministic } from "@/lib/itinerary/generate";
import { emptyProfile, type TripProfile } from "@/lib/planner/profile";
import { estimatedLeadValue, scoreLead } from "@/lib/workflows/rules";
import { KNOWLEDGE_SEED } from "./knowledge-seed";

/**
 * Seeds an empty database with demo users, demonstration knowledge documents
 * and ~60 days of clearly flagged (`is_demo = 1`) sample business records so
 * dashboards are meaningful on first run. Uses a fixed PRNG seed so the demo
 * is reproducible; dates are relative to "now".
 */

interface SeedDb {
  run: (sql: string, params?: (string | number | null)[]) => unknown;
  get: <T>(sql: string, params?: (string | number | null)[]) => T | undefined;
  tx: <T>(fn: () => T) => T;
}

export const DEMO_PASSWORD = "demo1234";

export const DEMO_USERS = [
  { email: "admin@pyt-demo.test", name: "Asha Raman", role: "admin" },
  { email: "sales@pyt-demo.test", name: "Vikram Iyer", role: "sales" },
  { email: "sales2@pyt-demo.test", name: "Neha Kapoor", role: "sales" },
  { email: "support@pyt-demo.test", name: "Arjun Mehta", role: "support" },
  { email: "support2@pyt-demo.test", name: "Priya Nair", role: "support" },
  { email: "ops@pyt-demo.test", name: "Karthik Subramanian", role: "ops" },
  { email: "customer@pyt-demo.test", name: "Meera Krishnan", role: "customer" },
  { email: "customer2@pyt-demo.test", name: "Rahul Verma", role: "customer" },
] as const;

const DEMO_CUSTOMER_NAMES = [
  "Ananya Sharma", "Rohit Gupta", "Divya Menon", "Sanjay Patel", "Kavya Reddy", "Aditya Rao", "Pooja Singh", "Nikhil Joshi",
  "Lakshmi Iyer", "Farhan Khan", "Sneha Pillai", "Varun Malhotra", "Ishita Bose", "Manoj Kumar", "Ritika Das", "Suresh Babu",
  "Tanvi Desai", "Abhishek Nair", "Shreya Banerjee", "Gaurav Chopra",
];
const CITIES = ["Chennai", "Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Kolkata", "Pune", "Kochi"];
const TICKET_SAMPLES: { subject: string; body: string; category: string; priority: string }[] = [
  { subject: "Can I change my travel dates?", body: "We want to push our trip by a week. Is that possible?", category: "booking_change", priority: "normal" },
  { subject: "Refund status for cancelled trip", body: "I cancelled last week, when will I get my refund?", category: "cancellation_refund", priority: "high" },
  { subject: "Visa documents checklist", body: "What documents do we need for the visa?", category: "visa_documents", priority: "normal" },
  { subject: "Charged twice for the deposit", body: "My card shows two charges for the same deposit.", category: "payment", priority: "high" },
  { subject: "Vegetarian food options", body: "Will the hotel have vegetarian breakfast?", category: "itinerary_question", priority: "low" },
  { subject: "Missed connecting flight", body: "We missed our connection in Kuala Lumpur and are stranded at the airport.", category: "emergency", priority: "urgent" },
  { subject: "Add one more traveller", body: "My mother wants to join us, can we add her?", category: "booking_change", priority: "normal" },
  { subject: "Baggage allowance question", body: "How much luggage can we carry?", category: "general", priority: "low" },
  { subject: "Hotel check-in time", body: "Can we get early check-in on day 1?", category: "itinerary_question", priority: "normal" },
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const id = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;

export function seedIfEmpty(db: SeedDb) {
  const count = db.get<{ c: number }>("SELECT COUNT(*) c FROM users")?.c ?? 0;
  if (count > 0) return;
  if (process.env.SEED_DEMO_DATA === "false") return;
  db.tx(() => {
    seedUsers(db);
    seedKnowledge(db);
    if (process.env.SEED_BUSINESS_DATA !== "false") seedBusiness(db);
  });
}

function seedUsers(db: SeedDb) {
  // One hash shared by all demo accounts keeps first boot fast; these are demo-only credentials.
  const hash = hashPassword(DEMO_PASSWORD);
  const now = new Date().toISOString();
  for (const u of DEMO_USERS) {
    db.run("INSERT INTO users (id, email, name, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      id("usr"), u.email, u.name, u.role, hash, now, now,
    ]);
  }
}

function seedKnowledge(db: SeedDb) {
  const now = new Date().toISOString();
  for (const d of KNOWLEDGE_SEED) {
    db.run(
      "INSERT INTO knowledge_documents (id, slug, title, category, audience, body, tags, is_demo, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)",
      [id("kb"), d.slug, d.title, d.category, d.audience, d.body, d.tags, now],
    );
  }
}

function userId(db: SeedDb, email: string): string {
  return db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", [email])!.id;
}

function seedBusiness(db: SeedDb) {
  const rand = mulberry32(42);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const now = Date.now();
  const sales = [userId(db, "sales@pyt-demo.test"), userId(db, "sales2@pyt-demo.test")];
  const support = [userId(db, "support@pyt-demo.test"), userId(db, "support2@pyt-demo.test")];
  const ops = userId(db, "ops@pyt-demo.test");
  const meera = userId(db, "customer@pyt-demo.test");

  const popularity = ["bali", "bali", "bali", "thailand", "thailand", "dubai", "dubai", "singapore", "maldives", "vietnam", "switzerland", "japan"];
  const tripIds: { id: string; ownerId: string | null; anonId: string; createdAt: string }[] = [];

  for (let i = 0; i < 46; i++) {
    const daysAgo = Math.floor(rand() * 60);
    const createdAt = new Date(now - daysAgo * 86_400_000 - Math.floor(rand() * 36_000_000)).toISOString();
    const destinationId = pick(popularity);
    const d = DESTINATIONS.find((x) => x.id === destinationId)!;
    const adults = pick([1, 2, 2, 2, 3, 4]);
    const children = adults >= 2 && rand() < 0.4 ? pick([1, 2]) : 0;
    const duration = d.idealDays[0] + Math.floor(rand() * 3);
    const monthOffset = 1 + Math.floor(rand() * 5);
    const start = new Date(now + monthOffset * 30 * 86_400_000);
    const startIso = start.toISOString().slice(0, 10);
    const endIso = new Date(start.getTime() + (duration - 1) * 86_400_000).toISOString().slice(0, 10);
    const profile: TripProfile = {
      ...emptyProfile(),
      destinationId: d.id,
      destinationName: d.name,
      departureCity: pick(CITIES),
      startDate: rand() < 0.6 ? startIso : null,
      endDate: null,
      travelMonth: startIso.slice(0, 7),
      dateFlexibility: pick(["fixed", "flexible", "few_days"] as const),
      durationDays: duration,
      adults,
      children,
      childrenAges: children ? Array.from({ length: children }, () => 3 + Math.floor(rand() * 10)) : [],
      tripType: children ? "family" : adults === 2 ? pick(["couple", "honeymoon"] as const) : adults === 1 ? "solo" : "friends",
      interests: Array.from(new Set([pick(d.interests), pick(d.interests)])),
      pace: pick(["relaxed", "balanced", "packed"] as const),
      budgetAmount: Math.round((60_000 + rand() * 140_000) / 5000) * 5000 * (adults + children),
      budgetScope: "total",
      budgetIncludesFlights: rand() < 0.7,
      accommodation: pick(["budget", "midrange", "midrange", "luxury"] as const),
      needsFlights: true,
      flightClass: "economy",
    };
    if (profile.startDate) profile.endDate = endIso;

    // How far did this customer get? Weighted towards earlier stages.
    const r = rand();
    const progress = r < 0.25 ? "planning" : r < 0.6 ? "itinerary_ready" : r < 0.8 ? "saved" : "handoff_requested";
    const isMeera = i < 2;
    const ownerId = isMeera ? meera : null;
    const anonId = id("anon");
    const name = isMeera ? "Meera Krishnan" : DEMO_CUSTOMER_NAMES[i % DEMO_CUSTOMER_NAMES.length];
    const email = isMeera ? "customer@pyt-demo.test" : rand() < 0.75 ? `${name.toLowerCase().replace(/\s+/g, ".")}@example.com` : null;
    const tripId = id("trip");
    const title = `${d.name} · ${start.toLocaleString("en-US", { month: "short" })} ${start.getFullYear()}`;
    tripIds.push({ id: tripId, ownerId, anonId, createdAt });

    let total: number | null = null;
    let itineraryId: string | null = null;
    if (progress !== "planning") {
      const itin = buildItinerary({ tripId, version: 1, destination: d, profile, plans: planDaysDeterministic(d, profile), generatedBy: "seed:deterministic", now: createdAt });
      total = itin.budget.total;
      itineraryId = itin.id;
      db.run(
        `INSERT INTO trips (id, user_id, anon_id, title, status, destination_id, destination_name, start_date, end_date, travel_month,
           duration_days, travellers, estimated_total, currency, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', 1, ?, ?)`,
        [tripId, ownerId, anonId, title, progress, d.id, d.name, profile.startDate, profile.endDate, profile.travelMonth, duration, adults + children, total, createdAt, createdAt],
      );
      db.run(
        `INSERT INTO itineraries (id, trip_id, version, destination_id, input_hash, generated_by, summary, hotel_json, transport_json, budget_json,
           total_estimate, currency, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?)`,
        [itin.id, tripId, d.id, itin.inputHash, itin.generatedBy, itin.summary, JSON.stringify(itin.hotel), JSON.stringify(itin.transport), JSON.stringify(itin.budget), total, createdAt, createdAt],
      );
      for (const day of itin.days) {
        db.run("INSERT INTO itinerary_days (id, itinerary_id, day_number, title, area, date) VALUES (?, ?, ?, ?, ?, ?)", [day.id, itin.id, day.dayNumber, day.title, day.area, day.date]);
        day.items.forEach((it, pos) =>
          db.run(
            `INSERT INTO itinerary_items (id, day_id, position, kind, catalog_ref, title, description, area, duration_hours, est_cost, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [it.id, day.id, pos, it.kind, it.catalogRef, it.title, it.description, it.area, it.durationHours, it.estCost, it.reason],
          ),
        );
      }
    } else {
      db.run(
        `INSERT INTO trips (id, user_id, anon_id, title, status, destination_id, destination_name, start_date, end_date, travel_month,
           duration_days, travellers, currency, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?, ?, ?, 'INR', 1, ?, ?)`,
        [tripId, ownerId, anonId, title, d.id, d.name, profile.startDate, profile.endDate, profile.travelMonth, duration, adults + children, createdAt, createdAt],
      );
    }
    db.run(
      `INSERT INTO trip_preferences (id, trip_id, profile_json, field_status_json, last_question, version, created_at, updated_at) VALUES (?, ?, ?, '{}', NULL, 1, ?, ?)`,
      [id("pref"), tripId, JSON.stringify(profile), createdAt, createdAt],
    );
    db.run(
      `INSERT INTO conversations (id, kind, trip_id, user_id, anon_id, summary, status, created_at, updated_at) VALUES (?, 'planner', ?, ?, ?, ?, 'active', ?, ?)`,
      [id("conv"), tripId, ownerId, anonId, `Demo planning session for ${d.name}`, createdAt, createdAt],
    );

    // Lead for every qualified session.
    const handoff = progress === "handoff_requested";
    const stageRoll = rand();
    const stage = handoff
      ? stageRoll < 0.35 ? "won" : stageRoll < 0.75 ? "proposal_sent" : "qualified"
      : progress === "planning"
        ? stageRoll < 0.6 ? "new" : "lost"
        : stageRoll < 0.35 ? "new" : stageRoll < 0.6 ? "contacted" : stageRoll < 0.8 ? "qualified" : stageRoll < 0.9 ? "proposal_sent" : "lost";
    const leadId = id("lead");
    const assignee = pick(sales);
    const followUpDue = stage === "won" || stage === "lost" ? null : new Date(now + (Math.floor(rand() * 7) - 2) * 86_400_000).toISOString();
    db.run(
      `INSERT INTO leads (id, trip_id, user_id, anon_id, name, email, destination, travel_month, travellers, budget, currency, source, stage, score,
         estimated_value, assigned_to, next_follow_up_at, lost_reason, dedup_key, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        leadId, tripId, ownerId, anonId, name, email, d.name, profile.travelMonth, adults + children, profile.budgetAmount,
        rand() < 0.85 ? "ai_planner" : "website", stage,
        scoreLead(profile, { hasContact: !!email, hasItinerary: progress !== "planning", handoffRequested: handoff }),
        estimatedLeadValue(profile, total), assignee, followUpDue, stage === "lost" ? pick(["No response", "Budget too low", "Booked elsewhere", "Postponed trip"]) : null,
        `trip:${tripId}`, createdAt, createdAt,
      ],
    );
    db.run("INSERT INTO lead_activities (id, lead_id, actor_user_id, type, body, created_at) VALUES (?, ?, NULL, 'created', ?, ?)", [
      id("act"), leadId, `Lead created automatically from the AI trip planner (demo record).`, createdAt,
    ]);
    if (stage !== "new") {
      db.run("INSERT INTO lead_activities (id, lead_id, actor_user_id, type, body, created_at) VALUES (?, ?, ?, 'stage_changed', ?, ?)", [
        id("act"), leadId, assignee, `Moved to ${stage} (demo record).`, new Date(Date.parse(createdAt) + 86_400_000).toISOString(),
      ]);
    }
    if (followUpDue) {
      db.run("INSERT INTO follow_ups (id, lead_id, due_at, channel, note, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)", [
        id("fu"), leadId, followUpDue, pick(["call", "email", "whatsapp"]), "Follow up on itinerary questions", assignee, createdAt,
      ]);
    }
    if (handoff && itineraryId) {
      const opsStatus = stage === "won" ? "customer_accepted" : pick(["pending", "in_review", "quote_sent", "failed"]);
      db.run(
        `INSERT INTO booking_handoffs (id, trip_id, itinerary_id, requested_by_user_id, contact_name, contact_email, contact_phone, notes,
           customer_confirmed_at, confirmation_text, idempotency_key, provider, provider_status, provider_reference, ops_status, assigned_to,
           quoted_total, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'demo-handoff-desk', 'not_submitted', NULL, ?, ?, ?, 1, ?, ?)`,
        [
          id("hof"), tripId, itineraryId, ownerId, name, email ?? "unknown@example.com", createdAt,
          "I confirm I want a travel expert to check availability and send a final quote. I understand nothing is booked yet.",
          id("idem"), opsStatus, opsStatus === "pending" ? null : ops, opsStatus === "quote_sent" || opsStatus === "customer_accepted" ? Math.round((total ?? 0) * 1.04) : null,
          createdAt, createdAt,
        ],
      );
    }
  }

  // Support tickets over the period.
  for (let i = 0; i < 22; i++) {
    const sample = TICKET_SAMPLES[i % TICKET_SAMPLES.length];
    const daysAgo = Math.floor(rand() * 45);
    const createdAt = new Date(now - daysAgo * 86_400_000 - Math.floor(rand() * 30_000_000)).toISOString();
    const trip = tripIds[Math.floor(rand() * tripIds.length)];
    const statusRoll = rand();
    const status = daysAgo > 7 ? (statusRoll < 0.75 ? "closed" : "resolved") : statusRoll < 0.3 ? "open" : statusRoll < 0.55 ? "in_progress" : statusRoll < 0.7 ? "pending_customer" : statusRoll < 0.8 ? "escalated" : "resolved";
    const responded = status !== "open";
    const firstResponse = responded ? new Date(Date.parse(createdAt) + (sample.priority === "urgent" ? 10 : 60 + rand() * 600) * 60_000).toISOString() : null;
    const resolvedAt = status === "resolved" || status === "closed" ? new Date(Date.parse(createdAt) + (4 + rand() * 60) * 3_600_000).toISOString() : null;
    const ticketId = id("tkt");
    db.run(
      `INSERT INTO support_tickets (id, ref, user_id, anon_id, trip_id, subject, category, priority, status, assigned_to, escalated, escalation_reason,
         contact_email, csat_score, first_response_at, resolved_at, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        ticketId, `PYT-${1001 + i}`, trip.ownerId, trip.anonId, trip.id, sample.subject, sample.category, sample.priority, status,
        responded || sample.priority === "urgent" ? pick(support) : null, sample.priority === "urgent" || status === "escalated" ? 1 : 0,
        sample.priority === "urgent" ? "Urgent travel problem" : status === "escalated" ? "Policy-sensitive request" : null,
        "customer@example.com", resolvedAt && rand() < 0.8 ? pick([3, 4, 4, 5, 5, 5]) : null, firstResponse, resolvedAt, createdAt, resolvedAt ?? firstResponse ?? createdAt,
      ],
    );
    db.run("INSERT INTO support_messages (id, ticket_id, author_type, author_user_id, body, internal, created_at) VALUES (?, ?, 'customer', ?, ?, 0, ?)", [
      id("smsg"), ticketId, trip.ownerId, sample.body, createdAt,
    ]);
    if (firstResponse) {
      db.run("INSERT INTO support_messages (id, ticket_id, author_type, author_user_id, body, internal, created_at) VALUES (?, ?, 'agent', ?, ?, 0, ?)", [
        id("smsg"), ticketId, pick(support), "Thanks for reaching out — I'm looking into this for you now. (demo reply)", firstResponse,
      ]);
    }
  }
}
