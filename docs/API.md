# API reference

All endpoints are Next.js route handlers under `/api`, exchange JSON, and are validated with Zod.

**Errors** always look like `{ "error": { "code": "...", "message": "...", "details": ... } }`, with status 400 `validation_error`/`bad_request`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`, 409 `conflict`/`invalid_transition`/`version_conflict`, 413 `payload_too_large`, 429 `rate_limited` (with `Retry-After`), 503 `voice_unavailable`, or 500 `internal_error`.

**Identity.** Signed-in users carry an http-only `pyt_session` cookie. Every visitor also gets an anonymous `pyt_anon` cookie, which owns trips and tickets until sign-in.

**Lists** accept `?page=&pageSize=` (max 100) and return `{ items, total, page, pageSize }`.

**Rate limits (per IP and per actor, per minute):** AI 20, auth 10, other writes 60, reads 300.

**Who can call what:**
- *Public*: callable by anyone; anonymous visitors can use it.
- *Owner*: only the customer who owns the record (by account, or by anonymous session for unclaimed records).
- A permission name (e.g. `leads:read`): employees whose role has that permission; see `src/lib/auth/permissions.ts`.

Every response includes `Server-Timing: app;dur=<ms>, db;dur=<ms>;desc="<n> queries"` (measured handler and database time; no data).

## Auth & profile
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/auth/signup` | Public | `{name,email,password,phone?}`. Always creates a customer, and claims anonymous trips. |
| POST | `/api/auth/login` | Public | `{email,password}` → `{user}` and sets the session cookie |
| POST | `/api/auth/logout` | Any | Clears the session |
| GET | `/api/profile` | Any | `{user, isEmployee, permissions}` |
| GET | `/api/health` | Public | DB and AI mode check |

## AI conversations
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/ai/chat` | Public (owner of trip) | `{mode:"planner", tripId?, message, clientMessageId?, channel?}` → updated profile, completion, `turn {reply, question, stage, captured, recommendations}`, `ai {source, notice}`. `{mode:"support", conversationId?, tripId?, message, clientMessageId?}` → `{reply, sources, triage, offerTicket, ticket}` |
| GET | `/api/ai/status` | Public | Mode, models, voice availability. Never includes secrets. |
| POST | `/api/ai/voice/session` | Owner of trip (AI rate limit) | `{tripId}` → ephemeral `{clientSecret, expiresAt, model}` (10-minute expiry; turn detection on, auto-responses off) or 503 `voice_unavailable` in mock mode. The permanent key never leaves the server. |
| GET | `/api/ai/conversations/[id]` | Owner / employee | Conversation metadata |
| GET | `/api/ai/conversations/[id]/messages` | Owner / employee | Paginated messages |

## Trip preferences
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/trips/preferences` | Public | Starts a planning session (trip, preferences, conversation, greeting) |
| GET | `/api/trips/preferences/[id]` | Owner / `trips:read_all` | Accepts a preferences id or trip id. Returns profile, statuses, messages, current question. |
| PATCH | `/api/trips/preferences/[id]` | Owner | `{updates: Partial<TripProfile>, clear?: FieldKey[], expectedVersion?}`. Structured edits through the same rules as chat. |

## Itineraries & destinations
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/itineraries/generate` | Owner | `{tripId, force?}` → 201 new version, or 200 `reused:true` when inputs are unchanged |
| GET | `/api/itineraries/[id]` | Owner / `trips:read_all` | Days, items, hotel, transport, budget |
| PATCH | `/api/itineraries/[id]` | Owner | One of `{op:"remove",itemId}`, `{op:"replace",itemId,catalogRef?}`, `{op:"move",itemId,direction}`, `{op:"moveToDay",itemId,dayNumber}`, `{op:"add",dayNumber,catalogRef}`, `{op:"regenerateDay",dayNumber}`, `{op:"setHotelTier",tier}` → `{itinerary, description, affectedDays}` |
| GET | `/api/itineraries/[id]/alternatives?itemId=` | Owner / employee | Unused suitable activities |
| GET | `/api/destinations` | Public | Demo catalog summaries |
| GET | `/api/destinations/recommendations` | Public | `?tripId=` or `?interests=a,b&month=&budget=&travellers=&days=` → deterministic top picks |

## Trips & booking handoff
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/trips` | Owner | Caller's trips. `?scope=all&status=&q=` needs `trips:read_all`. |
| GET | `/api/trips/[id]` | Owner / `trips:read_all` | Trip, profile, itinerary, handoff. Lead and audit are included for employees only. |
| PATCH | `/api/trips/[id]` | Owner | `{title?, status?: "saved"|"cancelled", contact?}` |
| POST | `/api/trips/[id]/duplicate` | Owner | Copies preferences into a new draft |
| POST | `/api/bookings/handoff` | Owner | `{tripId, contactName, contactEmail, contactPhone?, notes?, confirm:true, idempotencyKey}`. Idempotent; never reports a booking as confirmed without a provider reference. |
| GET | `/api/bookings/handoff/[id]` | `trips:read_all` | Handoff, allowed transitions, audit |
| PATCH | `/api/bookings/handoff/[id]` | `trips:write_ops` | `{opsStatus?, assignedTo?, quotedTotal?, note?}`. Provider status can't be set here. |
| GET | `/api/operations/handoffs` | `trips:read_all` | Handoff queue (`?status=&q=`) |

## Support
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/support/tickets` | Public | `{message, subject?, tripId?, conversationId?, contactEmail?, idempotencyKey?}`. Category, priority and escalation are triaged automatically. |
| GET | `/api/support/tickets` | Owner | Caller's tickets. `?scope=all&status=active|…&priority=&category=&assignedTo=me|unassigned|<id>&escalated=true&q=&sort=` needs `tickets:read`. |
| GET | `/api/support/tickets/[id]` | Owner / `tickets:read` | Ticket and messages. Internal notes are shown to `tickets:write` only. |
| PATCH | `/api/support/tickets/[id]` | `tickets:write` / Owner | Employee: `{status?, assignedTo?, priority?, escalate?, escalationReason?}`. Customer: `{status?:"closed", csatScore?}`. |
| POST | `/api/support/tickets/[id]/messages` | Owner / `tickets:write` | `{body, internal?}` (`internal` is for staff only) |
| GET | `/api/support/conversation` | Public | Caller's latest support chat |
| GET | `/api/support/faq` | Public | Public demonstration help articles |

## Leads & sales
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/leads` | `leads:read` | `?q=&stage=&assignedTo=me|unassigned|<id>&source=&sort=created_desc|score_desc|follow_up_asc|value_desc` |
| POST | `/api/leads` | `leads:write` | Manual lead. 409 if an open lead exists for the same email and destination. |
| GET | `/api/leads/[id]` | `leads:read` | Lead, allowed transitions, preferences, itinerary summary, activities, follow-ups |
| PATCH | `/api/leads/[id]` | `leads:write` | `{stage?, assignedTo?, nextFollowUpAt?, lostReason?, note?}`. The stage state machine is enforced and a reason is required for `lost`. |
| GET / POST | `/api/leads/[id]/follow-ups` | `leads:read` / `leads:write` | `{dueAt, channel, note?}` |
| PATCH | `/api/leads/[id]/follow-ups/[followUpId]` | `leads:write` | `{status:"done"|"cancelled"}` |

## Dashboard, analytics, copilot, admin
| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/dashboard/overview` | `dashboard:read` | `?days=1..365` (default 30). KPIs, lead → booking-request conversion (with previous period), funnel, destinations, daily series, queues, audit-log activity feed, rule-detected exceptions filtered by role, demo/live record counts |
| GET | `/api/dashboard/conversion` | `dashboard:read` | `?days=` funnel |
| GET | `/api/analytics/reports` | `analytics:read` | `?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv`. JSON includes `previous` (same metrics for the preceding period of equal length). Admins also get AI usage. |
| POST | `/api/copilot/chat` | `copilot:use` | `{message, leadId?, ticketId?}` → `{facts, documents, answer, suggestions, draft, ai}`. Leads and tickets are permission-checked. |
| GET | `/api/copilot/knowledge` | `copilot:use` | List of documents, or `?q=` search. Internal docs need `knowledge:read_internal`. |
| GET | `/api/users` | `users:list` | Employee directory (`?role=`) |
| GET / PATCH | `/api/admin/settings` | `settings:manage` | `{monthlyBudgetUsd?, dailyRequestsPerActor?, liveAiEnabled?}` |
| GET | `/api/admin/usage` | `settings:manage` | AI usage by category and outcome (`?days=`) |
| GET | `/api/admin/performance` | `settings:manage` | Measured per-route p50/p95/p99, DB time, query count, error/timeout rates, cache hit rates (since server start) and AI latency/outcomes/tokens/cost (24 h) |
| GET | `/api/audit` | `audit:read` | `?entityType=&entityId=&limit=` |

## AI Command Center & workspace
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/command/chat` | `copilot:use` | `{message, conversationId?, context?: {leadId?, ticketId?, customerKey?}}` → `{answer, nextSteps, draft, toolCalls[], records[], pendingActions[], ai{planner, composer, notice}}`. Reads execute; writes are returned as proposals. |
| GET | `/api/command/chat` | `copilot:use` | The employee's latest persisted command conversation and its write actions |
| GET | `/api/command/overview` | `dashboard:read` | All Command Center queues, filtered by role (no AI call) |
| GET | `/api/command/actions` | `copilot:use` | AI action log (`?status=pending|completed|failed|rejected|expired&mine=true&limit=`) |
| POST | `/api/command/actions/[id]/confirm` | Proposer or admin, plus the tool's permission | Re-authorizes, re-validates, executes. 409 `already_decided` / `expired`. |
| POST | `/api/command/actions/[id]/reject` | Proposer or admin | Marks the proposal rejected; it never runs |
| GET | `/api/search?q=` | `dashboard:read` | Global search, grouped and limited to record types the role may see |
| GET | `/api/notifications` | `dashboard:read` | Derived notifications plus AI activity (mode, requests and tool calls in the last hour, fallbacks today, pending approvals) |
| GET | `/api/customers` | `leads:read` or `tickets:read` | Customers derived from accounts and guest planning sessions (`?q=&kind=registered|guest`) |
| GET | `/api/customers/[key]` | `leads:read` or `tickets:read` | Trips, leads (sales only), tickets (support only), conversation summaries |
| GET | `/api/knowledge` | `copilot:use` | Approved documents (internal ones need `knowledge:read_internal`) |
| POST | `/api/knowledge` | `knowledge:manage` (admin) | Publish a document `{title, category, audience, body, tags}` |
| PATCH | `/api/knowledge/[id]` | `knowledge:manage` | Edit; bumps the version, which invalidates cached answers |
| GET | `/api/settings/overview` | `dashboard:read` | AI config (never the key), guard rails, integration status, role matrix |

`GET /api/trips?scope=all` also accepts `&flag=over_budget|awaiting_review|no_itinerary`. `GET /api/trips/[id]` includes a compact `conversation` (summary + latest messages) for employees. `GET /api/operations/handoffs` includes `counts` by ops status. `GET /api/analytics/reports` includes `value` with estimated trip value, open pipeline estimate, accepted-but-unconfirmed quotes, and confirmed revenue kept separate.

Planner chat responses (`POST /api/ai/chat`, mode `planner`) include `turn.itineraryUpdate` when a revision request changed the itinerary through tools.
