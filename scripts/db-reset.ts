/**
 * Deletes the local SQLite database and recreates it with migrations and demo
 * seed data. Usage: npm run db:reset
 */
import { rmSync } from "node:fs";
import { all, closeDb } from "../src/lib/db";
import { getDatabasePath } from "../src/lib/config";
import { DEMO_PASSWORD, DEMO_USERS } from "../src/lib/db/seed";

const path = getDatabasePath();
closeDb();
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
const counts = all<{ name: string; c: number }>(
  `SELECT 'users' name, COUNT(*) c FROM users UNION ALL SELECT 'trips', COUNT(*) FROM trips UNION ALL SELECT 'leads', COUNT(*) FROM leads
   UNION ALL SELECT 'support_tickets', COUNT(*) FROM support_tickets UNION ALL SELECT 'knowledge_documents', COUNT(*) FROM knowledge_documents`,
);
closeDb();
console.log(`Recreated ${path}`);
for (const r of counts) console.log(`  ${r.name}: ${r.c}`);
console.log(`Demo accounts (password "${DEMO_PASSWORD}"): ${DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(", ")}`);
