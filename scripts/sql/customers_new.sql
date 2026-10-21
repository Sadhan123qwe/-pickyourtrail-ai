WITH guests AS (
  SELECT l.anon_id, MAX(l.name) AS name, MAX(l.email) AS email, MAX(l.phone) AS phone, MIN(l.is_demo) AS is_demo
  FROM leads l WHERE l.user_id IS NULL AND l.anon_id IS NOT NULL GROUP BY l.anon_id
),
customers AS (
  SELECT 'user:' || u.id AS key, 'registered' AS kind, u.name, u.email, u.phone, 0 AS is_demo, u.created_at AS created_at
  FROM users u WHERE u.role = 'customer'
  UNION ALL
  SELECT 'guest:' || g.anon_id, 'guest', g.name, g.email, g.phone, g.is_demo, NULL FROM guests g
),
trip_agg AS (
  SELECT CASE WHEN user_id IS NOT NULL THEN 'user:' || user_id ELSE 'guest:' || anon_id END AS key, COUNT(*) AS trips, MAX(updated_at) AS last_trip
  FROM trips WHERE user_id IS NOT NULL OR anon_id IS NOT NULL GROUP BY key
),
lead_agg AS (
  SELECT CASE WHEN user_id IS NOT NULL THEN 'user:' || user_id ELSE 'guest:' || anon_id END AS key, COUNT(*) AS open_leads, SUM(estimated_value) AS pipeline_value
  FROM leads WHERE stage NOT IN ('won','lost') AND (user_id IS NOT NULL OR anon_id IS NOT NULL) GROUP BY key
),
ticket_agg AS (
  SELECT CASE WHEN user_id IS NOT NULL THEN 'user:' || user_id ELSE 'guest:' || anon_id END AS key, COUNT(*) AS open_tickets
  FROM support_tickets WHERE status NOT IN ('resolved','closed') AND (user_id IS NOT NULL OR anon_id IS NOT NULL) GROUP BY key
)
SELECT c.key, c.kind, c.name, c.email, c.phone,
  COALESCE(ta.trips, 0) AS trips,
  COALESCE(la.open_leads, 0) AS open_leads,
  COALESCE(tk.open_tickets, 0) AS open_tickets,
  la.pipeline_value AS pipeline_value,
  COALESCE(ta.last_trip, c.created_at, '') AS last_activity_at,
  c.is_demo
FROM customers c
LEFT JOIN trip_agg ta ON ta.key = c.key
LEFT JOIN lead_agg la ON la.key = c.key
LEFT JOIN ticket_agg tk ON tk.key = c.key
