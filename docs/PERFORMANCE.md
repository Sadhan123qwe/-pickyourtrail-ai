# Performance

All numbers below were **measured**, not estimated. Reproduce them with the commands in “How to reproduce”.

## Method

- **API latency:** `scripts/bench.mjs` against a production build (`next start`) with a fresh seeded database (~114 demo records), 60 sequential requests per endpoint (20 for AI turns) after one warm-up request, from the same machine. Mock AI mode (no API key), so AI turns measure our orchestration, not a model.
- **Server time** comes from the `Server-Timing` header that every API response now carries (`app` = handler time, `db` = database time, plus query count). **Client time** includes HTTP and Next.js routing overhead on localhost (~10–13 ms of every request).
- **Database at scale:** `scripts/db-scale-test.py` copies the database, multiplies the main tables (trips 9447, leads 9447, support_tickets 4422, support_messages 8442, conversations 9648, conversation_messages 17085, follow_ups 7638, itineraries 7437, booking_handoffs 2010, audit_events 201) and times each hot query (median of 7 runs) with `EXPLAIN QUERY PLAN`, before and after the candidate indexes.
- **Live monitoring:** `GET /api/admin/performance` (admins) reports p50/p95/p99, DB time, query count, error and timeout rates per route, cache hit rates, and AI latency/outcomes/tokens/cost from `usage_records` (last 24 h).

## Changes made

1. Prepared-statement cache in the SQLite adapter (each SQL string is compiled once).
2. Planner turn: no full itinerary load just to check existence; message inserts no longer re-read the row; lead sync reuses the already-loaded trip and preferences; reply, summary and CRM update are written in **one transaction**.
3. Itinerary generation writes (itinerary, trip estimate, audit, lead) in one transaction.
4. Analytics: the previous-period trend comparison uses a headline-KPI query set instead of re-running the whole report; lead and value counts are combined with conditional aggregates.
5. Customers summary rewritten from correlated `OR` subqueries (no index possible) to set-based aggregation.
6. Migration `0004_query_indexes`: indexes for the observed list/sort/filter queries (owner + updated_at for trips and tickets, trips/leads updated_at, leads owner, tickets by trip, handoffs and itineraries by created_at).
7. Frontend: identical in-flight GETs are shared, transient failures (network/502/503/504) retry twice with backoff, recently fetched data shows instantly while revalidating (per-tab memory only, cleared on any write and on sign-out), and accidental double submits of the same planner message are ignored.

## API latency (ms): baseline → after

| Endpoint | Server p50 | Server p95 | DB avg | Queries | Client p50 | Client p95 |
|---|---|---|---|---|---|---|
| GET /api/trips (customer list) | 1 → 0.8 | 1.6 → 1.5 | 0.6 → 0.4 | 2 → 2 | 16.2 → 14.1 | 18.2 → 18.2 |
| GET /api/trips/preferences/:id (planner snapshot) | 1.6 → 1.5 | 2.2 → 2.3 | 1 → 0.8 | 12 → 9 | 14.9 → 12.1 | 19.9 → 20.1 |
| GET /api/trips/:id (trip detail) | 1.7 → 2 | 2.3 → 2.8 | 0.8 → 0.7 | 8 → 8 | 15.4 → 14 | 17.4 → 21.7 |
| GET /api/itineraries/:id | 1.1 → 1.2 | 2.1 → 1.7 | 0.7 → 0.5 | 6 → 6 | 16 → 12.6 | 18.8 → 18.1 |
| GET /api/destinations | 0.6 → 0.6 | 1 → 0.9 | 0.2 → 0.1 | 1 → 1 | 14.9 → 10.2 | 17.6 → 17.9 |
| GET /api/support/tickets (customer) | 0.9 → 0.7 | 1.4 → 1.5 | 0.6 → 0.3 | 2 → 2 | 15.9 → 14.8 | 19.7 → 19.5 |
| GET /api/dashboard/overview | 4 → 3.5 | 6 → 5.4 | 3.2 → 2.9 | 42 → 42 | 14.8 → 15.9 | 20.6 → 24.8 |
| GET /api/analytics/reports | 4.7 → 2.6 | 6 → 3.6 | 3.7 → 1.7 | 58 → 32 | 15.7 → 15.6 | 21.2 → 23.9 |
| GET /api/leads (page 1) | 0.9 → 1.2 | 1.7 → 2 | 0.6 → 0.7 | 3 → 3 | 14.5 → 10.5 | 17.6 → 20.7 |
| GET /api/leads/:id | 2.1 → 1.7 | 2.7 → 2.4 | 1.1 → 0.6 | 12 → 9 | 15.2 → 13.5 | 19 → 17.1 |
| GET /api/support/tickets (ops queue) | 0.9 → 1.1 | 1.4 → 1.7 | 0.7 → 0.7 | 3 → 3 | 15 → 14.7 | 17.4 → 21 |
| GET /api/support/tickets/:id | 0.9 → 0.9 | 1.1 → 1.5 | 0.6 → 0.4 | 4 → 4 | 16 → 15.4 | 17.9 → 23.4 |
| GET /api/trips?scope=all | 1.5 → 1.8 | 1.9 → 2.4 | 1 → 1.1 | 3 → 3 | 10.3 → 15.3 | 17.9 → 20.8 |
| GET /api/operations/handoffs | 1.1 → 1.2 | 1.6 → 1.9 | 0.7 → 0.7 | 4 → 4 | 13.1 → 14.8 | 18.1 → 18.5 |
| GET /api/command/overview | 3.2 → 4.8 | 4.2 → 8.6 | 2.7 → 3.5 | 16 → 16 | 14.2 → 16.1 | 20.3 → 24.4 |
| GET /api/notifications | 1.3 → 1.1 | 2 → 1.6 | 0.9 → 0.5 | 10 → 10 | 15.1 → 12.3 | 19.2 → 17.7 |
| GET /api/search?q=ba | 2.7 → 3 | 3.6 → 5 | 2.2 → 2.6 | 7 → 7 | 15 → 15.5 | 19 → 22.2 |
| GET /api/customers | 3.1 → 2.6 | 4.2 → 4 | 2.6 → 2.1 | 3 → 3 | 15.2 → 15 | 19.3 → 20.6 |
| POST /api/ai/chat (planner turn, mock AI) | 17 → 10.3 | 22.5 → 16 | 12.1 → 5.1 | 26.3 → 22.3 | 30.7 → 20 | 39.4 → 30.7 |
| POST /api/command/chat (mock AI) | 12.2 → 8.8 | 13.9 → 15.9 | 10.6 → 9.1 | 12 → 10 | 23.5 → 16.8 | 34.4 → 27.3 |

**Reading this honestly:** at demo scale almost every read is already under ~5 ms server-side, and client time is dominated by fixed HTTP/Next.js overhead, so most rows are within run-to-run noise (a few are slightly higher after). The measurable wins are the AI planner turn (server p50 17 → 10 ms, DB 12 → 5 ms), the Copilot/Command chat (server p50 12 → 9 ms) and analytics (58 → 32 queries, server p50 4.7 → 2.6 ms). The indexes matter as data grows — see below.

## Database at scale (ms, median)

| Query | Before | After | Plan after |
|---|---|---|---|
| leads list (newest, page 1) | 0.06 | 0.06 | SCAN l USING INDEX idx_leads_created / SEARCH u USING INDEX sqlite_autoindex_users_1 (id=? |
| leads count by stage | 0.04 | 0.04 | SEARCH l USING COVERING INDEX idx_leads_stage (stage=?) |
| global search leads (LIKE, newest 5) | 3.49 | 0.01 | SCAN leads USING INDEX idx_leads_updated |
| trips list all (recent, page 1) | 0.96 | 0.04 | SCAN t USING INDEX idx_trips_updated |
| customer's own trips | 0.45 | 0.21 | SEARCH t USING INDEX idx_trips_user_updated (user_id=?) |
| guest's own trips | 0.28 | 0.2 | SEARCH t USING INDEX idx_trips_anon_updated (anon_id=?) |
| customer's own tickets | 0.29 | 0.22 | SEARCH t USING INDEX idx_tickets_user_updated (user_id=?) |
| tickets for a trip | 0.21 | 0.01 | SEARCH support_tickets USING INDEX idx_tickets_trip (trip_id=?) |
| leads for a guest customer | 0.37 | 0.07 | SEARCH x USING INDEX idx_leads_owner (user_id=? AND anon_id=?) / USE TEMP B-TREE FOR ORDER |
| handoffs created in last 30d | 0.17 | 0.01 | SEARCH booking_handoffs USING COVERING INDEX idx_handoffs_created (created_at>?) |
| itineraries per day (series) | 9.75 | 0.13 | SEARCH itineraries USING COVERING INDEX idx_itineraries_created (created_at>?) / USE TEMP  |
| customers summary (OLD correlated OR) | 331.75 | 68.91 | MERGE (UNION ALL) / LEFT / SCAN u / CORRELATED SCALAR SUBQUERY 8 / SEARCH t USING INDEX id |
| customers summary (NEW set-based) | 20.34 | 18.31 | MERGE (UNION ALL) / LEFT / MATERIALIZE trip_agg / SCAN trips / USE TEMP B-TREE FOR GROUP B |

The customers summary is still the heaviest query (linear in the number of trips/leads/tickets); at much larger volumes it should be backed by a maintained summary table.

## AI latency

In mock mode AI calls take no network time. With a key configured, `/api/admin/performance` reports per-category p50/p95 latency, failure/fallback rate, tokens and estimated cost. Responses are not streamed, so first-response and full-response latency are the same number. **No live OpenAI measurements exist yet** because no key was available while building.

## How to reproduce

```bash
npm run build
RATE_LIMIT_MULTIPLIER=100 node scripts/e2e-server.mjs 3200 data/bench.db   # relaxes the per-user limiter for load testing only
node scripts/bench.mjs http://localhost:3200 60 docs/perf/after.json
python scripts/db-scale-test.py data/bench.db 200
```
