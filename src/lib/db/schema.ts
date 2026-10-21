/**
 * Ordered SQLite migrations. Each migration runs once and is recorded in
 * `schema_migrations`. Add new migrations to the end; never edit applied ones.
 *
 * Conventions: TEXT primary keys (random ids), ISO-8601 UTC timestamps,
 * CHECK constraints for status enums, ON DELETE CASCADE for owned children.
 */
export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "0001_init",
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','sales','support','ops','admin')),
  password_hash TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- sha256 of the opaque cookie token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  anon_id TEXT,
  title TEXT NOT NULL,
  title_is_custom INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN
    ('planning','itinerary_ready','saved','handoff_requested','booked','completed','cancelled')),
  destination_id TEXT,
  destination_name TEXT,
  start_date TEXT,
  end_date TEXT,
  travel_month TEXT,
  duration_days INTEGER CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 60),
  travellers INTEGER CHECK (travellers IS NULL OR travellers BETWEEN 1 AND 40),
  estimated_total INTEGER,
  currency TEXT NOT NULL DEFAULT 'INR',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE INDEX idx_trips_user ON trips(user_id);
CREATE INDEX idx_trips_anon ON trips(anon_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_trips_created ON trips(created_at);

CREATE TABLE trip_preferences (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL,
  field_status_json TEXT NOT NULL,
  last_question TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('planner','support','copilot')),
  trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  anon_id TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_conversations_trip ON conversations(trip_id);
CREATE INDEX idx_conversations_owner ON conversations(user_id, anon_id);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','agent','system')),
  content TEXT NOT NULL,
  meta_json TEXT,
  client_message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conversation ON conversation_messages(conversation_id, created_at);
CREATE UNIQUE INDEX idx_messages_client_id ON conversation_messages(conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE TABLE itineraries (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  destination_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  summary TEXT NOT NULL,
  hotel_json TEXT NOT NULL,
  transport_json TEXT NOT NULL,
  budget_json TEXT NOT NULL,
  total_estimate INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (trip_id, version)
);
CREATE INDEX idx_itineraries_trip ON itineraries(trip_id, version);

CREATE TABLE itinerary_days (
  id TEXT PRIMARY KEY,
  itinerary_id TEXT NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL CHECK (day_number >= 1),
  title TEXT NOT NULL,
  area TEXT,
  date TEXT,
  UNIQUE (itinerary_id, day_number)
);

CREATE TABLE itinerary_items (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL REFERENCES itinerary_days(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('activity','transfer','free_time')),
  catalog_ref TEXT,
  title TEXT NOT NULL,
  description TEXT,
  area TEXT,
  duration_hours REAL,
  est_cost INTEGER NOT NULL DEFAULT 0,
  reason TEXT
);
CREATE INDEX idx_items_day ON itinerary_items(day_id, position);

CREATE TABLE booking_handoffs (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  itinerary_id TEXT REFERENCES itineraries(id) ON DELETE SET NULL,
  requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  notes TEXT,
  customer_confirmed_at TEXT NOT NULL,
  confirmation_text TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_status TEXT NOT NULL CHECK (provider_status IN
    ('not_submitted','submitted','provider_confirmed','provider_failed')),
  provider_reference TEXT,
  ops_status TEXT NOT NULL DEFAULT 'pending' CHECK (ops_status IN
    ('pending','in_review','quote_sent','customer_accepted','failed','cancelled')),
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  quoted_total INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- a confirmed provider status must carry a provider reference
  CHECK (provider_status <> 'provider_confirmed' OR provider_reference IS NOT NULL)
);
CREATE INDEX idx_handoffs_trip ON booking_handoffs(trip_id);
CREATE INDEX idx_handoffs_status ON booking_handoffs(ops_status);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  anon_id TEXT,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  destination TEXT,
  travel_month TEXT,
  travellers INTEGER,
  budget INTEGER,
  currency TEXT NOT NULL DEFAULT 'INR',
  source TEXT NOT NULL CHECK (source IN ('ai_planner','support','manual','website')),
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN
    ('new','contacted','qualified','proposal_sent','won','lost')),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  estimated_value INTEGER,
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  next_follow_up_at TEXT,
  lost_reason TEXT,
  dedup_key TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- One open lead per opportunity: closed (won/lost) leads do not block new ones.
CREATE UNIQUE INDEX idx_leads_open_dedup ON leads(dedup_key) WHERE stage NOT IN ('won','lost');
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);
CREATE INDEX idx_leads_created ON leads(created_at);
CREATE INDEX idx_leads_trip ON leads(trip_id);

CREATE TABLE lead_activities (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_lead_activities_lead ON lead_activities(lead_id, created_at);

CREATE TABLE follow_ups (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('call','email','whatsapp','meeting')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_follow_ups_due ON follow_ups(status, due_at);
CREATE INDEX idx_follow_ups_lead ON follow_ups(lead_id);

CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  anon_id TEXT,
  trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN
    ('booking_change','cancellation_refund','payment','visa_documents','itinerary_question','emergency','general')),
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN
    ('open','in_progress','pending_customer','escalated','resolved','closed')),
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  escalated INTEGER NOT NULL DEFAULT 0,
  escalation_reason TEXT,
  contact_email TEXT,
  csat_score INTEGER CHECK (csat_score IS NULL OR csat_score BETWEEN 1 AND 5),
  first_response_at TEXT,
  resolved_at TEXT,
  idempotency_key TEXT UNIQUE,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (user_id IS NOT NULL OR anon_id IS NOT NULL)
);
CREATE INDEX idx_tickets_status ON support_tickets(status);
CREATE INDEX idx_tickets_owner ON support_tickets(user_id, anon_id);
CREATE INDEX idx_tickets_assigned ON support_tickets(assigned_to);
CREATE INDEX idx_tickets_created ON support_tickets(created_at);

CREATE TABLE support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('customer','agent','ai','system')),
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0,
  sources_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_support_messages_ticket ON support_messages(ticket_id, created_at);

CREATE TABLE knowledge_documents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('public','internal')),
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id, created_at);
CREATE INDEX idx_audit_created ON audit_events(created_at);

CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,           -- 'user:<id>' or 'anon:<id>'; no names or emails
  category TEXT NOT NULL,
  provider TEXT NOT NULL,            -- 'openai' | 'mock' | 'cache'
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK (outcome IN
    ('ok','mock','cache_hit','fallback','error','rate_limited','budget_exceeded','limit_exceeded')),
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_usage_actor ON usage_records(actor_key, created_at);
CREATE INDEX idx_usage_created ON usage_records(created_at);

CREATE TABLE response_cache (
  key TEXT PRIMARY KEY,              -- only non-personal, shared content is cached here
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    id: "0002_ai_actions",
    sql: `
-- Every tool invocation by the AI orchestration layer: reads, proposed
-- (awaiting human approval), confirmed/completed, rejected and failed actions.
CREATE TABLE ai_actions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('command_center','planner','support')),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_key TEXT NOT NULL,
  tool TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('read','write')),
  args_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed','proposed','rejected','failed','expired')),
  summary TEXT,
  records_json TEXT,
  result_json TEXT,
  error TEXT,
  requires_confirmation INTEGER NOT NULL DEFAULT 0,
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_actions_status ON ai_actions(status, created_at);
CREATE INDEX idx_ai_actions_actor ON ai_actions(actor_user_id, created_at);
CREATE INDEX idx_ai_actions_conversation ON ai_actions(conversation_id);
`,
  },
  {
    id: "0003_provenance_bookings",
    sql: `
-- Where each trip preference came from: stated by the customer, inferred by the
-- planner, an application default, or explicitly confirmed by the customer.
ALTER TABLE trip_preferences ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';

-- Provider-confirmed bookings. Rows are written ONLY by a real booking-provider
-- adapter that returns a confirmation reference; the demo adapter never writes here.
CREATE TABLE provider_bookings (
  id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL REFERENCES booking_handoffs(id) ON DELETE CASCADE,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled','failed')),
  total INTEGER CHECK (total IS NULL OR total >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_reference)
);
CREATE INDEX idx_provider_bookings_trip ON provider_bookings(trip_id);
`,
  },
  {
    id: "0004_query_indexes",
    sql: `
-- Indexes for observed hot queries, validated with scripts/db-scale-test.py (results: docs/perf/scale-test.json).
-- Composite (owner, updated_at) indexes replace the single-column owner indexes.
CREATE INDEX IF NOT EXISTS idx_trips_user_updated ON trips(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_trips_anon_updated ON trips(anon_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_trips_updated ON trips(updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(user_id, anon_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user_updated ON support_tickets(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_trip ON support_tickets(trip_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_created ON booking_handoffs(created_at);
CREATE INDEX IF NOT EXISTS idx_itineraries_created ON itineraries(created_at);
DROP INDEX IF EXISTS idx_trips_user;
DROP INDEX IF EXISTS idx_trips_anon;
ANALYZE;
`,
  },
];
