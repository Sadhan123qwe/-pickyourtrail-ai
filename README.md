# Pickyourtrail AI — travel & business platform (interview build)

One platform, two workspaces, one data model:

- **Customer workspace** (`/`): an AI-led planner. Customers describe a trip in plain language, the planner asks only for what's missing, generates a day-by-day itinerary with transparent estimates, revises it on request ("make it slower", "cheaper options", "replace the water park"), saves it and hands it to a travel expert.
- **Enterprise operations workspace** (`/admin`): an AI Command Center plus leads, customers, trips, booking operations, support, knowledge, analytics and settings, all reading the same customer, conversation, trip, lead and ticket records.

The AI is an orchestration layer, not a chat widget. It acts only through a registry of validated, permission-checked business tools; consequential changes wait for human approval; and every tool call is logged.

> **Demo build.** Prices are estimates from a sample catalog, policy documents are demonstration content (not official Pickyourtrail terms), and no booking provider is connected — nothing is ever booked or charged.

## Quick start

Requirements: Node.js **22.13+** (built and tested on Node 24.20) and npm.

```bash
npm install
npm run dev          # http://localhost:3000
```

That's all. With no configuration the app runs in **mock AI mode** with a local SQLite database (`data/pickyourtrail.db`) that is created and seeded automatically on first request: 8 demo accounts, 12 demonstration help/policy documents and ~60 days of sample business records (flagged `is_demo` and labelled in the UI).

### Demo accounts

All passwords are `demo1234`. The sign-in page has one-click buttons for each.

| Role | Email | Can access |
|---|---|---|
| Customer | `customer@pyt-demo.test` | Own trips and tickets |
| Sales | `sales@pyt-demo.test` | Overview, Leads & CRM, Trips (read), Copilot, Analytics |
| Support | `support@pyt-demo.test` | Overview, Support ops, Trips (read), Copilot |
| Operations | `ops@pyt-demo.test` | Overview, Trips & bookings, Support (read), Copilot, Analytics |
| Admin | `admin@pyt-demo.test` | Everything, plus AI budget & usage controls |

Customers don't need an account: planning works anonymously (an http-only session cookie), and signing up later moves those trips to the account.

### Enabling live AI (optional)

1. Copy `.env.example` to `.env.local` (git-ignored) and set `OPENAI_API_KEY` to a **newly created** key. Never paste a key into source code, a chat or a screenshot. A key that has been shared that way must be revoked.
2. Optionally set the models. The defaults below follow the current OpenAI models page; accounts differ, so the check in step 3 confirms access.

   | Variable | Default | Used for |
   |---|---|---|
   | `OPENAI_MODEL` | `gpt-6-luna` | Routine work |
   | `OPENAI_MODEL_ADVANCED` | same as `OPENAI_MODEL` | Itinerary planning only |
   | `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1-mini` | Voice |
   | `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | Voice transcription; scheduled for shutdown 2027-02-26 |

3. Run **`npm run ai:check`**. It makes a few small real requests: confirms the key works, checks each configured model is available to your API project, sends one structured trip-planning request and validates the answer, and creates one Realtime voice session. It prints PASS / FAIL / BLOCKED per check and never prints the key. Admins can run the same check from **Settings → Test live AI connection**.
4. Run **`npm run test:live`** for the live integration tests. They use real, billable requests: planner turn, itinerary, voice session ownership, Copilot, and a check that no secret appears in responses or logs. Without a key they report as skipped (blocked), not passed.
5. Restart `npm run dev`. The planner shows "Live AI" on live answers and "Demo mode · rules-based" otherwise. Usage, latency and estimated cost appear in Settings → Measured performance.

**Live voice manual check.** Automated tests can't use a real microphone or speakers. With a key configured:
1. Open `/plan`, choose **Talk to Pickyourtrail AI** and allow the microphone.
2. Confirm the robot greets you aloud and its status moves Connecting → Speaking → Listening.
3. Say the Bali example. The transcript and Trip Profile should update, and the robot should speak the next question.
4. Talk over the robot and confirm it stops (barge-in). Then try Mute/Resume and End.
5. Reload the page and confirm the trip is still there.

The key is read only on the server (`src/lib/config.ts` imports `server-only`); it never reaches the browser bundle. If the key is missing, malformed or rejected, the app keeps working with the deterministic engine and says so in the UI.

> **Corporate networks:** if HTTPS traffic is inspected by a proxy whose root certificate is installed in Windows/macOS but not known to Node, OpenAI calls fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` (the app falls back to rules and records `connection_error`). Start Node with the OS certificate store: `set NODE_OPTIONS=--use-system-ca` (PowerShell: `$env:NODE_OPTIONS="--use-system-ca"`) before `npm run dev`. The same applies to `npx playwright install`.

### Robot voice planning

The planner has a speech-to-speech assistant shown as the approved Pickyourtrail robot (`public/images/pickyourtrail-ai-robot.png`; optimized crops in `public/images/robot/`). The same robot appears on Home, in the planner, in customer support, the Employee AI Copilot and the Command Center console.

- **Live voice** (when `OPENAI_API_KEY` is set): OpenAI Realtime over WebRTC. The server issues a short-lived client secret per session after checking that the caller owns the trip (`POST /api/ai/voice/session`). The default model is `gpt-realtime-2.1-mini` (the current, non-deprecated mini realtime model); override it with `OPENAI_REALTIME_MODEL`.
- **Browser voice (demo fallback)** without a key: the browser's Web Speech API listens and speaks. It is labelled "Browser voice (demo)" and uses no AI audio.
- **One brain:** both engines send each final transcript to the same planner API as typed messages and speak its reply. Trip state therefore lives in one place, the transcript and Trip Profile stay in sync, and everything survives a reload. Raw audio is never stored.
- **Honest states:** the robot shows connecting, listening, thinking, speaking, muted, disconnected, ended or error, driven only by real events. Live voice uses the official Realtime events (`input_audio_buffer.speech_started/stopped`, `conversation.item.input_audio_transcription.completed`, `output_audio_buffer.started/stopped/cleared`). Browser voice uses the Web Speech callbacks.
- **Audio-reactive visuals:** the rings follow measured microphone and output audio levels.
- **Controls:** mute/pause, resume, interrupt (live voice sends `response.cancel` + `output_audio_buffer.clear`; you can also simply talk over the robot), reconnect, end, and switch to text.
- **Limits:** sessions end automatically after 10 minutes. Live voice sessions use the AI rate limit and usage guard rails.
- **Robot speech:** the robot greets you aloud. When an itinerary is generated during a voice session, it stays on the page and explains the plan briefly.
- **Dictation:** the microphone button next to the text box still fills the box using browser speech recognition.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run typecheck` | Generates Next route types, then `tsc --noEmit` (strict mode) |
| `npm test` | Vitest unit + API tests (each test file gets a throwaway database) |
| `npm run test:e2e` | Production build, then Playwright end-to-end tests (needs `npx playwright install chromium` once) |
| `npm run db:reset` | Deletes and re-seeds the local database |
| `npm run db:retention` | Applies the retention policy: abandoned guest planning sessions and guest support chats older than `RETENTION_GUEST_DAYS` (90), expired sessions and cache entries, usage records older than `RETENTION_USAGE_DAYS` (400). Anything linked to a lead, ticket or booking request is kept. |
| `npm run ai:check` | Verifies the live OpenAI connection (models, one structured request, one voice session); PASS / FAIL / BLOCKED, never prints keys |
| `npm run test:live` | Live OpenAI integration tests (real, billable requests); reported as skipped/blocked without a key |
| `npm run bench` | API latency benchmark against a running server (see [docs/PERFORMANCE.md](docs/PERFORMANCE.md)) |
| `npm run demo:video` | Records a captioned chat → itinerary → CRM → Copilot → Support Ops walkthrough to `demo-video/` (needs `npm run build` first; demo mode, no OpenAI calls). With a full ffmpeg (`FFMPEG_PATH`) it writes MP4, otherwise WebM — see [docs/DEMO_VIDEO.md](docs/DEMO_VIDEO.md) |
| `npm run demo:voice-video` | Records a labelled voice-planning reenactment with two synthesized voices (customer + AI robot) to `demo-video/` (Windows only; demo mode, no OpenAI calls) |
| `npm run check:secrets` | Scans the built browser bundle (`.next/static`) for secret keys, client reads of server-only env vars and `NEXT_PUBLIC_` secrets; prints only file and rule names |
| `npm run verify` | lint → typecheck → tests → build → secret check |

## Pages

### Design system

The UI uses a controlled glassmorphism system defined in `src/app/globals.css` (tokens) and `src/components/ui.tsx` (components), built on three brand colours:

- **Lavender `#CBB3EB`**: brand surfaces, selected navigation, chips and the Trip Profile.
- **Chartreuse `#D4FF3F`**: AI actions, Send buttons, AI status dots and progress, always with navy `#17152F` text.
- **Tomato `#E34234`**: urgent tickets, failures and required-field markers only.

Neutrals: navy `#19172F` sidebars, page `#F7F6FC`, white surfaces, text `#191936`/`#696A91`, borders `#E6DDF5`, success `#16865D`, error `#C93232`. Lavender and chartreuse are too light for text on white, so two darker "ink" shades are derived for accessible text: violet `#5B3FA0` for links and olive `#4A6400` for AI labels. Reading surfaces stay 90%+ opaque; blur (8–16px) is limited to chrome, the top bars and panels. Charts use a brand-derived categorical palette that passes lightness, chroma, colour-blind separation and 3:1 contrast checks (`src/components/charts.tsx`); tomato is never used as a chart series. Destination photos are bundled locally in `public/images/destinations` (Unsplash licence) with hero and card crops, so none can break. No reference screenshot was attached to either redesign brief, so the written descriptions were followed.

**Customer workspace** (navy sidebar: Plan a new trip · Home · AI Trip Planner · My Trips · Destinations · Support · Profile & settings, plus recent trips; a compact desktop top bar with destination search; a navy header and drawer on mobile; a footer on every page except the planner)

| # | Page | Route |
|---|---|---|
| 1 | Home & discovery: scenic banner with the AI trip prompt and quick-start suggestions, resume your plans, value strip, featured destinations filterable by search, interest, month, budget and trip length, quick-start trip ideas | `/` |
| — | Destinations & inspiration: destinations in season this month, the full filterable catalog; the top-bar search lands here | `/destinations` |
| 2 | AI trip planner: three-region layout (navigation · conversation · Trip Profile), robot voice panel (speech-to-speech, see below), destination banner, adaptive questions with quick replies, timestamps, retry on failure, Trip Profile grouped with stated / assumed / default / confirmed tags, recap and confirmation before generating, "summarise my trip", save progress, refinement chips | `/plan` |
| 3 | Itinerary & recommendations: destination hero, day navigation, timed day timelines with reasons, replace/remove/reorder/move/add, AI assist (cheaper, slower, family-friendly, more culture, free text), hotel tier, itemised estimate | `/trips/[id]/itinerary` |
| 4 | Trip review & booking handoff: booking lifecycle stepper, travellers and dates, editable summary, included/excluded, itemised budget, explicit confirmation | `/trips/[id]/review` |
| 5 | My trips: search, status filters, lifecycle status, related support cases; resume, duplicate, cancel (with confirmation) | `/trips` |
| 6 | Customer support: help categories, searchable FAQ, grounded assistant, urgent escalation, tickets, ticket thread | `/support`, `/support/tickets/[id]` |
| — | Profile: account details, trip and ticket counts, sign out | `/account` |

**Enterprise operations workspace** (navy sidebar that collapses to an icon rail with tooltips, remembered per browser; chartreuse dots mark AI pages; top bar with global search, AI activity indicator, notifications, avatar and role)

| # | Page | Route |
|---|---|---|
| 7 | Business overview: 7/30/90-day range, KPIs with deltas incl. lead → booking-request conversion, activity chart, rule-detected exceptions, funnel, popular destinations, audit-log activity feed | `/admin` |
| 11 | **AI Command Center**: work queues (approvals, exceptions, stalled leads, follow-ups, escalations, handoffs, trips awaiting review, active conversations, recent AI actions) plus an AI console with tool transparency and approve/reject | `/admin/command-center` |
| 8 | Leads & sales CRM: budget and trip-date columns, rule-based suggested next action, planner conversation summary, stage/owner/follow-ups/notes, link to the Copilot | `/admin/leads` |
| — | Customers: one view across trips, leads, tickets and conversations | `/admin/customers` |
| 10a | Trips & itineraries: attention filters (awaiting review, over budget), read-only itinerary and conversation for staff | `/admin/trips` |
| 10b | Booking operations: handoff queue, status counts, lifecycle stepper (AI itinerary → quote requested → booking pending → provider-confirmed), operational notes, confirmed status changes, audit timeline | `/admin/bookings` |
| 9 | Support operations: filters, first-response SLA indicators from configured rules (urgent 15m, high 2h, normal 24h, low 48h — `src/lib/workflows/sla.ts`), AI case summary with source context, internal notes, AI-drafted replies that are never auto-sent | `/admin/support` |
| 11b | **Employee AI Copilot**: record picker (lead, customer, ticket), suggested prompts, conversation over the shared tool layer, selected-record summary, approved-knowledge search, source references, copyable drafts, approvals for proposed changes | `/admin/copilot` |
| — | Knowledge base: approved documents; admins can publish and version them | `/admin/knowledge` |
| 12 | Analytics & reports: trend comparison with the previous equal-length period, metric definitions, estimated value kept separate from confirmed revenue, CSV export, AI usage | `/admin/analytics` |
| — | Settings: AI configuration, cost guard rails, integration status, role/permission matrix | `/admin/settings` |

The old `/admin/operations` URL redirects to Booking Operations.

### Try the AI Command Center

Sign in as **Sales** and ask:

- "Show me leads who planned a trip but haven't continued to booking"
- "Show trips where the budget exceeds the customer's stated limit"
- "Summarize today's operational exceptions"

Then open a lead from the "Leads needing attention" queue, click **Ask AI**, and ask "Prepare a follow-up message for this lead". The AI drafts the message and proposes a follow-up task. Nothing happens until you click **Approve & run**, and nothing is sent to the customer (there's no messaging integration).

Sign in as **Support** and ask "Find support cases that need urgent attention". Lead questions are refused for that role.

### Try the Employee AI Copilot

Open **Employee AI Copilot** and try "Which leads need follow-up today?", "Summarize unresolved cases assigned to me" (as Support) or "Explain the approved cancellation policy". Pick a lead on the left, then "Summarize this lead's travel requirements" or "Draft a follow-up for this customer". Every answer lists the records it used, and drafts are only copied, never sent.

## Real vs. demo integrations

| Capability | Status in this build |
|---|---|
| AI preference extraction, itinerary activity selection, support answers, Command Center planning/answers, follow-up drafting | **Live** via OpenAI Responses API with strict JSON-schema output *when a key is configured*; otherwise a deterministic rules engine. Verified against a local OpenAI-compatible fake server in tests — **not** exercised against the real OpenAI API in this environment (no key was available). |
| Realtime voice | Implemented (ephemeral client secret + WebRTC). **Untested against the real service** for the same reason; returns "Voice demo unavailable" without a key. |
| Browser dictation | Live (browser's Web Speech API; availability depends on the browser). |
| Persistence | **Live, local**: SQLite via Node's built-in `node:sqlite`. |
| Authentication | **Live, local**: scrypt password hashes, hashed session tokens in http-only cookies. |
| Supabase / PostgreSQL / RLS | **Not implemented.** The repository layer (`src/lib/repos`) is the boundary to replace. |
| Destinations, hotels, flights, activities, prices | **Demo catalog** (`src/lib/catalog`), 8 destinations, labelled as estimates. |
| Booking provider | **Demo adapter** (`src/lib/providers/booking.ts`) that never confirms; ops workflow is real. |
| Knowledge base | 12 **demonstration** documents plus any an admin publishes, with keyword retrieval in SQLite. |
| AI tool orchestration, approvals, action log | **Live, local**: tool registry, human approval flow and `ai_actions` log, all in this app. |
| Email / WhatsApp sending, payments | **Not connected.** Follow-ups are recorded as tasks; the AI says so instead of pretending to send. |
| Destination imagery | Local copies of Unsplash photos (8 destinations, checked to match each place), with a branded fallback. |

## Tests (as last run)

- **Unit + API (Vitest): 141 tests in 12 files, all passing.** They cover:
  - the live-AI health check against a local OpenAI-compatible server: BLOCKED without a key, PASS when live, a clear FAIL for a model the project can't use, admin-only, and no key or ephemeral secret in any output;
  - the voice state machine, and both voice engines with fake browser APIs: Realtime event mapping, the ephemeral secret, interrupt events, mute, microphone denial, failed connections, dropped connections and cleanup;
  - which preferences were stated, inferred, defaulted or confirmed; the recap before generation; and the trip summary that needs no AI call;
  - voice sessions issued only for the caller's own trip and never in mock mode; AI quota exhaustion; the new tools (booking handoff needs confirmation; ownership and argument validation); `Server-Timing` headers and the admin-only metrics endpoint; the retention policy; and itinerary reuse when inputs are unchanged;
  - the planner (extraction, conversation engine, revision detection, skipping an optional question after an unparseable answer, and the brief's "five-day family trip to Bali … ₹1.5 lakh" sentence captured in one turn);
  - budget maths and itinerary editing;
  - lead and ticket state machines, triage, permissions;
  - the Command Center / Copilot router (the brief's example questions and the Copilot prompts);
  - support SLA indicators and the lead next-action rules;
  - overview conversion and activity, analytics previous-period comparison, role-filtered exceptions;
  - JSON-schema strictness, cost estimates, rate limiting;
  - the full API workflow;
  - authentication and authorization, including role-filtered tools, search, customers and settings;
  - the approval lifecycle (propose → approve once → 409 on repeat; another rep can't approve; rejected actions never run);
  - planner revisions through tools;
  - the live AI adapter against a fake OpenAI server, including a test that the model can't call tools outside the user's role, invent tools, or pass invalid arguments.
- **End-to-end (Playwright, production build): 7 tests, all passing.** Two cover robot voice planning with the browser speech APIs replaced by controllable fakes (Playwright can't speak into a microphone):
  - the robot greets aloud, the customer's spoken request fills the Trip Profile with only missing questions asked, the robot speaks the reply, mute/resume/end work, and everything survives a reload;
  - a denied microphone falls back to text.

  The other five cover the brief's 15-step acceptance flow:
  - customer plans in natural language, gets an itinerary, replaces an activity, saves and requests a booking;
  - the lead appears in the CRM;
  - an employee asks the Command Center to summarize the lead, prepares a follow-up and approves it, sees the suggested next action, and asks the Employee AI Copilot (answer with sources);
  - a ticket is created, found and assigned;
  - metrics update, and data persists after reload;
  - unauthorized access is blocked;
  - the app runs in mock mode and recovers from a real provider connection error.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design and cost controls, and [docs/API.md](docs/API.md) for every endpoint.

## Known limitations

- No real AI key was available while building, so live OpenAI behaviour (answer quality, latency, real token costs, live Realtime voice audio) is unverified; only the integration contract is tested, against a fake OpenAI server and fake WebRTC/Web Speech objects.
- Browser voice depends on the browser's Web Speech support (best in Chrome/Edge). It doesn't listen while the robot is speaking, so interrupting uses the Interrupt button; live Realtime voice supports talking over the robot.
- Supabase/Postgres and row-level security are not implemented; access control is enforced in server code over SQLite. SQLite + in-memory rate limiting assume a single server instance.
- Destinations outside the 8-destination catalog can't be planned (the planner says so honestly).
- No email/WhatsApp sending: follow-ups and replies are recorded, not delivered.
- The Command Center stores its conversation and every tool call, but only keeps the latest conversation per employee.
- Approval requests expire after one hour.
- Prices and exchange rates are fixed demo values; there is no live availability.
- No Content-Security-Policy header yet (basic security headers are set).
"# -pickyourtrail-ai" 
