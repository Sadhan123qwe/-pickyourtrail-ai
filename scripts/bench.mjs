// API latency benchmark against a running server (use a production build).
// Usage: node scripts/bench.mjs <baseUrl> [iterations=40] [out.json]
// Start the server with RATE_LIMIT_MULTIPLIER=100 so the limiter does not reject benchmark traffic.
// Reports client-observed p50/p95 plus server-side app/db time from Server-Timing.
import { writeFileSync } from "node:fs";

const [base = "http://localhost:3200", itArg = "40", out] = process.argv.slice(2);
const N = Number(itArg);

function cookieJar() {
  const jar = new Map();
  return {
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    store(res) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
    },
  };
}

async function client(email) {
  const jar = cookieJar();
  const call = async (method, path, body) => {
    const t0 = performance.now();
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", cookie: jar.header(), "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    jar.store(res);
    const st = res.headers.get("server-timing") ?? "";
    const app = Number(/app;dur=([\d.]+)/.exec(st)?.[1] ?? NaN);
    const db = Number(/db;dur=([\d.]+)/.exec(st)?.[1] ?? NaN);
    const queries = Number(/"(\d+) queries"/.exec(st)?.[1] ?? NaN);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, ms, app, db, queries, json };
  };
  if (email) {
    const r = await call("POST", "/api/auth/login", { email, password: "demo1234" });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  }
  return call;
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] * 10) / 10 : 0;
};
const mean = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0);

async function measure(name, fn, n = N) {
  await fn(); // warm-up (not counted)
  const samples = [];
  for (let i = 0; i < n; i++) samples.push(await fn(i));
  const bad = samples.filter((s) => s.status >= 400).length;
  return {
    name,
    n,
    errors: bad,
    p50: pct(samples.map((s) => s.ms), 50),
    p95: pct(samples.map((s) => s.ms), 95),
    serverP50: pct(samples.map((s) => s.app), 50),
    serverP95: pct(samples.map((s) => s.app), 95),
    dbMean: mean(samples.map((s) => s.db)),
    queries: mean(samples.map((s) => s.queries)),
  };
}

const customer = await client("customer@pyt-demo.test");
const admin = await client("admin@pyt-demo.test");
const trips = (await customer("GET", "/api/trips")).json.items;
const trip = trips.find((t) => t.itinerary_id) ?? trips[0];
const lead = (await admin("GET", "/api/leads?pageSize=1")).json.items[0];
const ticket = (await admin("GET", "/api/support/tickets?scope=all&pageSize=1")).json.items[0];
const started = (await customer("POST", "/api/trips/preferences")).json;
const planTrip = started.trip.id;

const results = [];
const run = async (name, fn, n) => results.push(await measure(name, fn, n));
await run("GET /api/trips (customer list)", () => customer("GET", "/api/trips"));
await run("GET /api/trips/preferences/:id (planner snapshot)", () => customer("GET", `/api/trips/preferences/${trip.id}`));
await run("GET /api/trips/:id (trip detail)", () => customer("GET", `/api/trips/${trip.id}`));
await run("GET /api/itineraries/:id", () => customer("GET", `/api/itineraries/${trip.itinerary_id}`));
await run("GET /api/destinations", () => customer("GET", "/api/destinations"));
await run("GET /api/support/tickets (customer)", () => customer("GET", "/api/support/tickets"));
await run("GET /api/dashboard/overview", () => admin("GET", "/api/dashboard/overview?days=30"));
await run("GET /api/analytics/reports", () => admin("GET", "/api/analytics/reports"));
await run("GET /api/leads (page 1)", () => admin("GET", "/api/leads?page=1&pageSize=15"));
await run("GET /api/leads/:id", () => admin("GET", `/api/leads/${lead.id}`));
await run("GET /api/support/tickets (ops queue)", () => admin("GET", "/api/support/tickets?scope=all&status=active&pageSize=15"));
await run("GET /api/support/tickets/:id", () => admin("GET", `/api/support/tickets/${ticket.id}`));
await run("GET /api/trips?scope=all", () => admin("GET", "/api/trips?scope=all&page=1&pageSize=15"));
await run("GET /api/operations/handoffs", () => admin("GET", "/api/operations/handoffs?page=1&pageSize=15"));
await run("GET /api/command/overview", () => admin("GET", "/api/command/overview"));
await run("GET /api/notifications", () => admin("GET", "/api/notifications"));
await run("GET /api/search?q=ba", () => admin("GET", "/api/search?q=ba"));
await run("GET /api/customers", () => admin("GET", "/api/customers?page=1&pageSize=20"));
const msgs = ["Bali", "5 days", "December, flexible", "2 adults and 1 child aged 7", "1.5 lakh total", "yes including flights", "from Chennai", "beaches and culture", "relaxed", "mid-range"];
await run("POST /api/ai/chat (planner turn, mock AI)", (i = 0) => customer("POST", "/api/ai/chat", { mode: "planner", tripId: planTrip, message: msgs[i % msgs.length], clientMessageId: `bench-${Date.now()}-${i}-${Math.random()}` }), 20);
await run("POST /api/command/chat (mock AI)", () => admin("POST", "/api/command/chat", { message: "Which leads need follow-up today?" }), 20);

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("endpoint", 52), pad("n", 4), pad("p50", 8), pad("p95", 8), pad("srv p50", 9), pad("srv p95", 9), pad("db avg", 8), pad("queries", 8), "errors");
for (const r of results) console.log(pad(r.name, 52), pad(r.n, 4), pad(r.p50, 8), pad(r.p95, 8), pad(r.serverP50, 9), pad(r.serverP95, 9), pad(r.dbMean, 8), pad(r.queries, 8), r.errors);
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base, iterations: N, results }, null, 2));
