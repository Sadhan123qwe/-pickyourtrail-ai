"""
Scale test for query plans and indexes (run manually; not part of the app).

Copies a database, multiplies the main tables to ~SCALE x their size with new
ids, then prints EXPLAIN QUERY PLAN and median timings for the hot queries —
first as-is, then after applying the candidate indexes from migration 0004.

Usage: python scripts/db-scale-test.py data/bench.db [scale=200]
"""
import os, shutil, sqlite3, statistics, sys, time, tempfile, json

src = sys.argv[1] if len(sys.argv) > 1 else "data/bench.db"
SCALE = int(sys.argv[2]) if len(sys.argv) > 2 else 200
work = os.path.join(tempfile.gettempdir(), "pyt-scale-test.db")
for suffix in ("", "-wal", "-shm"):
    if os.path.exists(work + suffix):
        os.remove(work + suffix)
src_conn = sqlite3.connect(src)
dst_conn = sqlite3.connect(work)
src_conn.backup(dst_conn)
src_conn.close()
db = dst_conn
db.execute("PRAGMA foreign_keys = OFF")

TABLES = ["trips", "leads", "support_tickets", "support_messages", "conversations", "conversation_messages", "follow_ups", "itineraries", "booking_handoffs", "audit_events"]
UNIQUE_SUFFIX = {"leads": ["dedup_key"], "support_tickets": ["ref", "idempotency_key"], "conversation_messages": ["client_message_id"], "booking_handoffs": ["idempotency_key"]}

def cols(t):
    return [r[1] for r in db.execute(f"PRAGMA table_info({t})")]

for t in TABLES:
    c = cols(t)
    base = db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    if not base:
        continue
    exprs = []
    for name in c:
        if t == "itineraries" and name == "version":
            exprs.append("version + n.i * 1000")
        elif name == "id" or name in UNIQUE_SUFFIX.get(t, []):
            exprs.append(f"CASE WHEN {name} IS NULL THEN NULL ELSE {name} || '_s' || n.i END")
        elif name.endswith("_at") and name in ("created_at", "updated_at"):
            # spread synthetic rows over ~1 year so date filters/sorts are realistic
            exprs.append(f"strftime('%Y-%m-%dT%H:%M:%fZ', {name}, '-' || (n.i % 365) || ' days')")
        else:
            exprs.append(name)
    db.execute(f"""
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {SCALE})
      INSERT INTO {t} ({", ".join(c)}) SELECT {", ".join(exprs)} FROM {t}, n
    """)
db.commit()
sizes = {t: db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}

anon = db.execute("SELECT anon_id FROM trips WHERE user_id IS NULL AND anon_id IS NOT NULL LIMIT 1").fetchone()[0]
user = db.execute("SELECT user_id FROM trips WHERE user_id IS NOT NULL LIMIT 1").fetchone()[0]
trip = db.execute("SELECT id FROM trips LIMIT 1 OFFSET 5").fetchone()[0]
since = "2026-09-20T00:00:00.000Z"

OLD_CUSTOMERS = open("scripts/sql/customers_old.sql").read() if os.path.exists("scripts/sql/customers_old.sql") else None

QUERIES = {
    "leads list (newest, page 1)": ("SELECT l.*, u.name, t.status FROM leads l LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN trips t ON t.id = l.trip_id ORDER BY l.created_at DESC LIMIT 15", []),
    "leads count by stage": ("SELECT COUNT(*) FROM leads l WHERE l.stage = 'qualified'", []),
    "global search leads (LIKE, newest 5)": ("SELECT id, name FROM leads WHERE name LIKE '%an%' OR email LIKE '%an%' OR destination LIKE '%an%' ORDER BY updated_at DESC LIMIT 5", []),
    "trips list all (recent, page 1)": ("SELECT t.* FROM trips t ORDER BY t.updated_at DESC LIMIT 15", []),
    "customer's own trips": ("SELECT * FROM trips t WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 100", [user]),
    "guest's own trips": ("SELECT * FROM trips t WHERE t.user_id IS NULL AND t.anon_id = ? ORDER BY t.updated_at DESC LIMIT 100", [anon]),
    "customer's own tickets": ("SELECT * FROM support_tickets t WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 100", [user]),
    "tickets for a trip": ("SELECT id FROM support_tickets WHERE trip_id = ?", [trip]),
    "leads for a guest customer": ("SELECT id FROM leads x WHERE x.user_id IS NULL AND x.anon_id = ? ORDER BY x.created_at DESC LIMIT 50", [anon]),
    "handoffs created in last 30d": ("SELECT COUNT(*) FROM booking_handoffs WHERE created_at >= ?", [since]),
    "itineraries per day (series)": ("SELECT substr(created_at, 1, 10) d, COUNT(*) FROM itineraries WHERE created_at >= ? GROUP BY d", [since]),
}

def customers_new():
    return open("scripts/sql/customers_new.sql").read()

if OLD_CUSTOMERS:
    QUERIES["customers summary (OLD correlated OR)"] = (f"SELECT * FROM ({OLD_CUSTOMERS}) ORDER BY last_activity_at DESC LIMIT 20", [])
QUERIES["customers summary (NEW set-based)"] = (f"SELECT * FROM ({customers_new()}) ORDER BY last_activity_at DESC LIMIT 20", [])

def measure(label):
    out = {}
    for name, (sql, params) in QUERIES.items():
        plan = " | ".join(r[3] for r in db.execute("EXPLAIN QUERY PLAN " + sql, params))
        times = []
        reps = 3 if "OLD" in name else 7
        for _ in range(reps):
            t0 = time.perf_counter()
            db.execute(sql, params).fetchall()
            times.append((time.perf_counter() - t0) * 1000)
        out[name] = {"ms": round(statistics.median(times), 2), "plan": plan}
    print(f"\n=== {label} ===")
    for name, r in out.items():
        print(f"{r['ms']:>9.2f} ms  {name}\n             plan: {r['plan'][:150]}")
    return out

before = measure("BEFORE candidate indexes")
index_sql = open("scripts/sql/indexes_0004.sql").read()
db.executescript(index_sql)
db.execute("ANALYZE")
after = measure("AFTER candidate indexes")
print("\nrows:", json.dumps(sizes))
json.dump({"scale": SCALE, "rows": sizes, "before": before, "after": after}, open("docs/perf/scale-test.json", "w"), indent=2)
