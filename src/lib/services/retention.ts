import "server-only";
import { get, nowIso, run, tx } from "@/lib/db";

/**
 * Data retention. Raw audio is never stored (voice transcripts become ordinary
 * conversation messages). This purges data that has no business purpose any more:
 * - abandoned GUEST planning sessions (no account, no lead, booking request or ticket)
 *   untouched for `guestDays`, with their conversations and messages;
 * - guest support conversations with no ticket, untouched for `guestDays`;
 * - expired login sessions and expired shared-cache entries;
 * - AI usage records older than `usageDays` (kept for cost reporting).
 * Records linked to leads, tickets or booking requests are kept for operations.
 */
export interface RetentionPolicy {
  guestDays: number;
  usageDays: number;
}

export function retentionPolicy(): RetentionPolicy {
  const n = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { guestDays: n(process.env.RETENTION_GUEST_DAYS, 90), usageDays: n(process.env.RETENTION_USAGE_DAYS, 400) };
}

export function purgeExpiredData(policy: RetentionPolicy = retentionPolicy(), now = Date.now()) {
  const guestCutoff = new Date(now - policy.guestDays * 86_400_000).toISOString();
  const usageCutoff = new Date(now - policy.usageDays * 86_400_000).toISOString();
  return tx(() => {
    const abandoned = `SELECT t.id FROM trips t
      WHERE t.user_id IS NULL AND t.updated_at < ? AND t.status IN ('planning','itinerary_ready','cancelled')
        AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.trip_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM booking_handoffs h WHERE h.trip_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM support_tickets s WHERE s.trip_id = t.id)`;
    const guestTrips = get<{ c: number }>(`SELECT COUNT(*) c FROM (${abandoned})`, [guestCutoff])?.c ?? 0;
    const conversations = run(
      `DELETE FROM conversations WHERE trip_id IN (${abandoned})
         OR (kind = 'support' AND user_id IS NULL AND trip_id IS NULL AND updated_at < ?
             AND NOT EXISTS (SELECT 1 FROM support_tickets s WHERE s.conversation_id = conversations.id))`,
      [guestCutoff, guestCutoff],
    ).changes;
    run(`DELETE FROM trips WHERE id IN (${abandoned})`, [guestCutoff]);
    const sessions = run("DELETE FROM sessions WHERE expires_at < ?", [nowIso()]).changes;
    const cache = run("DELETE FROM response_cache WHERE expires_at < ?", [nowIso()]).changes;
    const usage = run("DELETE FROM usage_records WHERE created_at < ?", [usageCutoff]).changes;
    return { policy, guestTrips, conversations, sessions, cache, usage };
  });
}
