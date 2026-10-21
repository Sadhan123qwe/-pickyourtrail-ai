# Architecture

**One platform, one customer/trip data model, reusable AI services, many workflows.** A single Next.js 16 app (App Router, React 19, strict TypeScript) serves the customer site, the employee portal and a JSON API. Pages are client components that read and write through the API, so the database stays the source of truth.

```
Browser ──► Route handlers (src/app/api/**)  ── route() wrapper: actor, rate limit, errors, anon cookie
                    │
                    ▼
            Services (src/lib/services)       planner · itinerary · trips/handoff · support · copilot
              │            │           │
              ▼            ▼           ▼
   Planner engine     AI runner     Workflow rules        (pure, deterministic, unit-tested)
   (src/lib/planner)  (src/lib/ai)  (src/lib/workflows)
              │            │
              ▼            ▼
      Catalog + itinerary maths      OpenAI adapter / deterministic fallback
      (src/lib/catalog, itinerary)
                    │
                    ▼
            Repositories (src/lib/repos) ──► SQLite (node:sqlite, src/lib/db)
```

## UI shell and design system

- `src/app/globals.css` holds the colour, surface and motion tokens (navy navigation, blue primary, teal for AI, near-opaque reading surfaces, blur only on navigation/overlays, reduced-motion support).
- `src/components/ui.tsx` holds shared components; `src/components/feedback.tsx` provides toasts and confirmation dialogs app-wide.
- Customer pages render inside `CustomerShell` (`src/components/customer/shell.tsx`); employee pages inside `WorkspaceShell` (`src/components/workspace`). Sidebar items reflect permissions, but **every API route re-checks permissions**: hiding a menu item is not authorization.
- The Command Center console and the Employee AI Copilot share one response renderer (`src/components/admin/ai-response.tsx`) and one backend (`/api/command/chat`).
- Rule-based helpers used by the UI: first-response SLA (`src/lib/workflows/sla.ts`) and lead next action (`src/lib/workflows/next-action.ts`). Both are deterministic and unit-tested; neither changes data.

## AI orchestration layer (`src/lib/ai/tools`, `src/lib/services/command.ts`)

Both workspaces share one tool registry. A tool is a named business capability with:

- a Zod argument schema;
- an `authorize(actor)` role or ownership check;
- a kind (`read` or `write`) and whether it needs human confirmation;
- an optional `describe()` that validates a write and explains exactly what it will do;
- a `run()` made of ordinary server code.

The model never touches the database, SQL or code. It can only *name* a tool and pass JSON arguments, and the server validates and authorizes them again on every call.

**Employee tools.**
- Reads: `find_stalled_leads`, `find_follow_ups_due`, `find_my_open_tickets`, `get_lead_summary`, `get_customer_context`, `find_urgent_support_cases`, `get_ticket_summary`, `find_over_budget_trips`, `get_operational_exceptions`, `get_business_metrics`, `get_pending_operations`, `search_company_knowledge`, `draft_follow_up_message`.
- Writes that need approval: `schedule_follow_up`, `update_lead_stage`, `assign_ticket`, `escalate_ticket`.

**Customer tools.** `get_trip_profile`, `update_trip_preferences`, `search_destinations`, `generate_itinerary`, `update_itinerary`, `calculate_trip_budget`, `make_itinerary_cheaper`, `save_trip`, `create_or_update_lead`, `get_customer_support_context`, `create_support_ticket`, `search_public_knowledge`. These only touch the customer's own records and are reversible. Booking requests are deliberately not a tool: they need the explicit confirmation form.

**Command Center flow.**
1. A deterministic router (`command-router.ts`) maps common intents to a tool plan. When it is confident, no planning call is made to the model.
2. Otherwise the low-cost model returns a structured plan, choosing only from the tools this employee is authorized to use (the prompt lists only those).
3. Reads run immediately. Writes are stored in `ai_actions` as `proposed`, with a human-readable description and a one-hour expiry.
4. The answer is written from tool results only (model when live, template otherwise). The UI shows the tools called, the records used, the actions awaiting approval and the actions completed.
5. **Approve & run** re-checks the proposer (or an admin), the role and the arguments before executing. The result is recorded as `completed` or `failed` and audited. Repeat confirmations return 409, and rejected actions never run.

Requests no tool can satisfy (sending messages, refunds, booking changes) get an explicit "I can't do that" rather than a simulated success. Permission denials are logged as `rejected`, not counted as operational failures.

**Customer planner revisions.** Once an itinerary exists, the planner detects revision intents (slower or more adventurous, cheaper, replace or remove an activity, save, or changes to budget or dates) and chooses the cheapest correct tool:
- activity-affecting changes call `generate_itinerary`;
- cost-only changes call `calculate_trip_budget`, which re-prices in code with no AI;
- "cheaper" calls `make_itinerary_cheaper`, which lowers the hotel tier and swaps the priciest activity, also in code.

Each of these is logged to `ai_actions` (source `planner`), so they appear in the Command Center's "Recent AI actions".

**Command Center queues** (`repos/operations.ts`) are plain SQL over persisted records: stalled leads (itinerary but no booking request), follow-ups due, urgent or escalated tickets, handoffs needing action, trips awaiting customer review, active conversations, over-budget trips, exceptions and approvals. Each queue is filtered by role.

## Data model

`ai_actions` (every tool call: source, actor, tool, args, status `completed|proposed|rejected|failed|expired`, summary, records used, result, decider), `users`, `sessions`, `trips`, `trip_preferences` (structured profile JSON, field statuses, optimistic version), `conversations`, `conversation_messages`, `itineraries` (versioned, with input hash) → `itinerary_days` → `itinerary_items`, `booking_handoffs`, `leads` (partial unique index: one open lead per opportunity), `lead_activities`, `follow_ups`, `support_tickets`, `support_messages`, `knowledge_documents`, `audit_events`, `usage_records`, `response_cache`, `app_settings`. Schema and migrations: `src/lib/db/schema.ts`. CHECK constraints guard every status enum; a handoff can only be `provider_confirmed` if it carries a provider reference.

`provider_bookings` (migration 0003) holds provider-confirmed bookings and is written **only** by a real booking-provider adapter that returns a confirmation reference. The demo adapter never writes to it, so it stays empty. `trip_preferences.provenance_json` records whether each preference was **stated** by the customer, **inferred** by the planner (for example "kids" → family trip), an application **default** (for example "total" budget), or **confirmed** (recap accepted, or edited in the Trip Profile).

Migration 0004 adds indexes chosen from `EXPLAIN QUERY PLAN` on the hot list, sort and filter queries at scale (`scripts/db-scale-test.py`; results in `docs/PERFORMANCE.md`).

**Retention** (`src/lib/services/retention.ts`, `npm run db:retention`): abandoned guest sessions and stale guest support chats are purged after 90 days, along with expired sessions and cache entries. Usage records are purged after 400 days. Raw audio is never stored.

## Voice (`src/lib/voice`, `src/components/voice`)

- `machine.ts` is a pure state machine: idle → connecting → listening ⇄ thinking ⇄ speaking, plus muted, disconnected, ended and error. Only real engine events or explicit user actions move it.
- `engines.ts` has two engines behind one interface, with browser APIs injected so they can be unit-tested:
  - **Realtime (WebRTC):** a server-issued ephemeral secret, then an SDP exchange with `/v1/realtime/calls`. Data-channel events map to state transitions. The model is configured with `create_response: false`, so it only voices the planner's replies.
  - **Browser (Web Speech):** continuous recognition paused while speaking, and speech synthesis with a clear English voice.
- `use-voice-assistant.ts` handles the rest:
  - It sends each final transcript through the planner API and speaks the reply.
  - On barge-in it interrupts playback.
  - It greets the customer and enforces a 10-minute session limit.
  - It releases the microphone and connection on unmount.
- `RobotStage` and `RobotAvatar` render the approved mascot. Rings scale with measured audio levels (`AnalyserNode`). Under reduced-motion there is no animation.

## Performance and measurement

Every API response carries `Server-Timing: app;dur=…, db;dur=…;desc="N queries"`. Per-route p50/p95/p99, error and timeout rates, database time, query counts and cache hit rates are kept in memory (`src/lib/metrics.ts`) and served with AI latency, tokens and cost (from `usage_records`) at `GET /api/admin/performance`; admins see them in Settings.

Other performance features:
- The SQLite adapter caches prepared statements.
- Multi-step writes (planner turn, itinerary generation) run in one transaction.
- The browser shares identical in-flight GETs, retries transient failures twice with backoff, and keeps a 30-second per-tab cache cleared on any write.

See `docs/PERFORMANCE.md` for the measured baseline → after results.

## Adaptive trip discovery

1. The customer's message plus a **compact profile** (non-empty fields only) and the topic just asked go to an extractor. Live mode calls the low-cost model with a strict JSON schema; mock/fallback mode uses `rules-extractor.ts`. The full chat history is never sent.
2. `engine.ts` merges updates, applies inferences (children → family trip, honeymoon → 2 adults, a single date plus duration → end date), detects conflicts (dates vs. duration, children vs. ages, past dates), adds seasonality notes from the catalog, and picks the **next most useful unanswered question** in code. Essentials (destination, duration, dates, travellers, budget) come first. "I don't know yet" and "skip" are first-class answers, so nothing is asked twice.
3. Exploratory users ("suggest somewhere") answer a few questions first, then get three destinations from deterministic scoring.
4. The state is saved with an optimistic version check, so overlapping voice and text turns can't overwrite each other. Retried messages carry a client message id and are answered from the database, not the AI.
5. Before generating, a review step summarises the profile.

## Itineraries

The AI (advanced tier) may only **choose and order activity ids from the catalog** and write reasons. Code validates the ids, drops anything invented, filters unsuitable activities (kids, young children, accessibility), and computes every price: flights by cabin and party, rooms × nights, per-person activity pricing with child and infant rules, local transport by vehicle count, and meals. Unchanged inputs (same input hash) reuse the saved itinerary. Edits (`remove`, `replace`, `move`, `moveToDay`, `add`, `regenerateDay`, `setHotelTier`) are deterministic, touch only the affected days, and recompute the budget.

## Business workflows (`src/lib/services`)

| Trigger | Effect |
|---|---|
| Planning starts | Trip + preferences + conversation for the account or anonymous session |
| Enough detail (destination plus two of duration/travellers/budget/dates) | Lead created or updated (dedup key `trip:<id>`), assigned round-robin to sales, intro follow-up scheduled |
| Later preference changes | Lead updated; consecutive updates collapse into one activity entry |
| Itinerary generated / edited | Saved and versioned; lead activity and value updated; audit event |
| Booking request | Requires `confirm: true` and an idempotency key; provider adapter called; trip becomes `handoff_requested` (never `booked` without a provider reference); lead activity |
| Support message | Deterministic triage. Urgent → ticket escalated to a human immediately, no AI answer. Refunds/cancellations → human required. Otherwise a grounded answer with sources |
| Lead / ticket / handoff change | State machine check, activity/audit entry; dashboards read live aggregates |

## Low-cost AI

- **Model routing:** `OPENAI_MODEL` (routine: extraction, FAQ, copilot) and `OPENAI_MODEL_ADVANCED` (itinerary selection only). Model names live only in `config.ts`.
- **Code instead of AI:** question choice, conflicts, recommendations, triage, lead scoring, budgets, dates, edits, dashboards and permissions.
- **Structured outputs:** strict JSON schemas generated from Zod (`ai/json-schema.ts`), validated again with Zod, with one bounded retry on malformed output.
- **Context discipline:** compact profile, no history replay, input capped at 12k characters, stable system prompts plus `prompt_cache_key` per category so the provider can cache prefixes.
- **Reuse:** itinerary input-hash reuse; shared cache (24h) for non-personal FAQ answers keyed by question and document versions. Personal questions are never cached.
- **Guard rails:** `max_output_tokens` per call, SDK timeout and bounded retries with backoff, per-IP and per-actor rate limits (`rate-limit.ts`), per-actor daily AI request cap, admin monthly USD budget and kill switch (`/admin/analytics`). Every call is recorded in `usage_records`: model, category, tokens, cached tokens, estimated cost, latency, outcome and error code. No prompts or personal data are stored there.
- **Failure handling:** any provider error, quota, rate limit, timeout or budget block falls back to the deterministic engine with a user-visible notice. The customer is never blocked.

## Security

- The API key is read only on the server (`server-only` imports). Voice uses 10-minute ephemeral client secrets. A bundle scan for secrets is part of verification.
- scrypt password hashes; random session tokens stored only as SHA-256 hashes; http-only, SameSite=Lax cookies (Secure in production); sign-up can only create customers.
- Every route resolves the actor on the server and checks a permission matrix (`auth/permissions.ts`) or record ownership. Claimed records are no longer reachable through the anonymous cookie alone. CRM, audit and internal notes are stripped from customer responses.
- Zod validation on every input, 64 KB body cap, consistent error format, parameterised SQL only, model output rendered as text (no HTML injection), and AI output never executed.
- Headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, and a `Permissions-Policy` that allows the microphone only on this origin.

## Provider adapters

| Concern | Interface | Live | Demo |
|---|---|---|---|
| AI | `AiProvider` (`ai/provider.ts`) | `OpenAiProvider` | deterministic fallbacks per feature |
| Voice | `/api/ai/voice/session` + `planner/voice.ts` | OpenAI Realtime (WebRTC) | browser dictation / "unavailable" |
| Destinations, hotels, flights | `catalog/*` | — | sample catalog |
| Booking | `BookingProvider` (`providers/booking.ts`) | — | `demo-handoff-desk` (never confirms) |
| Knowledge | `searchKnowledge()` (`repos/knowledge.ts`) | — | TF-IDF over SQLite |
| Persistence | `repos/*` over `db/index.ts` | SQLite | — |
