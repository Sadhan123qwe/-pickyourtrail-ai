-- Candidate indexes, chosen from the hot queries in the repositories (see scripts/db-scale-test.py).
CREATE INDEX IF NOT EXISTS idx_trips_user_updated ON trips(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_trips_anon_updated ON trips(anon_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_trips_updated ON trips(updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(updated_at);
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(user_id, anon_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user_updated ON support_tickets(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_trip ON support_tickets(trip_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_created ON booking_handoffs(created_at);
CREATE INDEX IF NOT EXISTS idx_itineraries_created ON itineraries(created_at);
