WITH guests AS (
  SELECT l.anon_id, MAX(l.name) AS name, MAX(l.email) AS email, MAX(l.phone) AS phone, MIN(l.is_demo) AS is_demo
  FROM leads l WHERE l.user_id IS NULL AND l.anon_id IS NOT NULL GROUP BY l.anon_id
),
customers AS (
  SELECT 'user:' || u.id AS key, 'registered' AS kind, u.name, u.email, u.phone, u.id AS user_id, NULL AS anon_id, 0 AS is_demo, u.created_at AS created_at
  FROM users u WHERE u.role = 'customer'
  UNION ALL
  SELECT 'guest:' || g.anon_id, 'guest', g.name, g.email, g.phone, NULL, g.anon_id, g.is_demo, NULL FROM guests g
)
SELECT c.key, c.kind, c.name, c.email, c.phone,
  (SELECT COUNT(*) FROM trips t WHERE (c.user_id IS NOT NULL AND t.user_id = c.user_id) OR (c.anon_id IS NOT NULL AND t.user_id IS NULL AND t.anon_id = c.anon_id)) AS trips,
  (SELECT COUNT(*) FROM leads l WHERE ((c.user_id IS NOT NULL AND l.user_id = c.user_id) OR (c.anon_id IS NOT NULL AND l.user_id IS NULL AND l.anon_id = c.anon_id)) AND l.stage NOT IN ('won','lost')) AS open_leads,
  (SELECT COUNT(*) FROM support_tickets s WHERE ((c.user_id IS NOT NULL AND s.user_id = c.user_id) OR (c.anon_id IS NOT NULL AND s.user_id IS NULL AND s.anon_id = c.anon_id)) AND s.status NOT IN ('resolved','closed')) AS open_tickets,
  (SELECT SUM(l.estimated_value) FROM leads l WHERE ((c.user_id IS NOT NULL AND l.user_id = c.user_id) OR (c.anon_id IS NOT NULL AND l.user_id IS NULL AND l.anon_id = c.anon_id)) AND l.stage NOT IN ('won','lost')) AS pipeline_value,
  COALESCE((SELECT MAX(t.updated_at) FROM trips t WHERE (c.user_id IS NOT NULL AND t.user_id = c.user_id) OR (c.anon_id IS NOT NULL AND t.user_id IS NULL AND t.anon_id = c.anon_id)), c.created_at, '') AS last_activity_at,
  c.is_demo
FROM customers c
