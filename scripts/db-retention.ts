/**
 * Applies the data-retention policy (see src/lib/services/retention.ts).
 * Usage: npm run db:retention   (RETENTION_GUEST_DAYS / RETENTION_USAGE_DAYS override the defaults)
 */
import { closeDb } from "../src/lib/db";
import { purgeExpiredData } from "../src/lib/services/retention";

const result = purgeExpiredData();
closeDb();
console.log(
  `Retention applied (guest data ${result.policy.guestDays} days, usage ${result.policy.usageDays} days): ` +
    `${result.guestTrips} abandoned guest trips, ${result.conversations} conversations, ${result.sessions} expired sessions, ` +
    `${result.cache} expired cache entries, ${result.usage} old usage records removed.`,
);
