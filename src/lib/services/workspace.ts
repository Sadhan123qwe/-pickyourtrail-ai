import "server-only";
import { all, get } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/http";
import { getAiConfig } from "@/lib/config";
import { listAiActions } from "@/lib/repos/ai-actions";
import { listCustomers } from "@/lib/repos/customers";

interface SearchGroup {
  type: string;
  label: string;
  items: { id: string; title: string; subtitle: string; href: string }[];
}

/** Employee top bar: global search across only the records this employee may see. */
export function globalSearch(actor: Actor, q: string) {
  const like = `%${q}%`;
  const r = actor.role;
  const groups: SearchGroup[] = [];
  if (can(r, "leads:read")) {
    groups.push({
      type: "lead",
      label: "Leads",
      items: all<{ id: string; name: string; destination: string | null; stage: string }>(
        "SELECT id, name, destination, stage FROM leads WHERE name LIKE ? OR email LIKE ? OR destination LIKE ? ORDER BY updated_at DESC LIMIT 5",
        [like, like, like],
      ).map((l) => ({ id: l.id, title: l.name, subtitle: `${l.destination ?? "No destination"} · ${l.stage.replace("_", " ")}`, href: `/admin/leads?lead=${l.id}` })),
    });
  }
  if (can(r, "leads:read") || can(r, "tickets:read")) {
    groups.push({
      type: "customer",
      label: "Customers",
      items: listCustomers({ q, limit: 5, offset: 0 }).items.map((c) => ({
        id: c.key,
        title: c.name,
        subtitle: `${c.kind === "registered" ? "Registered" : "Guest"}${c.email ? ` · ${c.email}` : ""}`,
        href: `/admin/customers?customer=${encodeURIComponent(c.key)}`,
      })),
    });
  }
  if (can(r, "trips:read_all")) {
    groups.push({
      type: "trip",
      label: "Trips",
      items: all<{ id: string; title: string; status: string }>(
        "SELECT id, title, status FROM trips WHERE title LIKE ? OR destination_name LIKE ? ORDER BY updated_at DESC LIMIT 5",
        [like, like],
      ).map((t) => ({ id: t.id, title: t.title, subtitle: t.status.replace(/_/g, " "), href: `/admin/trips?trip=${t.id}` })),
    });
  }
  if (can(r, "tickets:read")) {
    groups.push({
      type: "ticket",
      label: "Support tickets",
      items: all<{ id: string; ref: string; subject: string; status: string }>(
        "SELECT id, ref, subject, status FROM support_tickets WHERE ref LIKE ? OR subject LIKE ? OR contact_email LIKE ? ORDER BY updated_at DESC LIMIT 5",
        [like, like, like],
      ).map((t) => ({ id: t.id, title: `${t.ref} · ${t.subject}`, subtitle: t.status.replace(/_/g, " "), href: `/admin/support?ticket=${t.id}` })),
    });
  }
  if (can(r, "copilot:use")) {
    const internal = can(r, "knowledge:read_internal") ? "" : "AND audience = 'public'";
    groups.push({
      type: "document",
      label: "Knowledge base",
      items: all<{ id: string; title: string; audience: string }>(`SELECT id, title, audience FROM knowledge_documents WHERE (title LIKE ? OR tags LIKE ?) ${internal} LIMIT 4`, [like, like]).map(
        (d) => ({ id: d.id, title: d.title, subtitle: d.audience, href: `/admin/knowledge?doc=${d.id}` }),
      ),
    });
  }
  return { query: q, groups: groups.filter((g) => g.items.length) };
}

/** Employee top bar: notifications and the AI activity indicator, derived from stored records. */
export function notifications(actor: Actor) {
  const r = actor.role;
  const items: { id: string; severity: "high" | "medium" | "info"; title: string; href: string }[] = [];
  const count = (sql: string, params: string[] = []) => get<{ c: number }>(sql, params)?.c ?? 0;
  if (can(r, "tickets:read")) {
    const urgent = count("SELECT COUNT(*) c FROM support_tickets WHERE status NOT IN ('resolved','closed') AND priority = 'urgent'");
    if (urgent) items.push({ id: "urgent", severity: "high", title: `${urgent} urgent support ticket${urgent > 1 ? "s" : ""} open`, href: "/admin/support" });
    const unassigned = count("SELECT COUNT(*) c FROM support_tickets WHERE status NOT IN ('resolved','closed') AND assigned_to IS NULL AND priority IN ('urgent','high')");
    if (unassigned) items.push({ id: "unassigned", severity: "medium", title: `${unassigned} high-priority ticket${unassigned > 1 ? "s" : ""} unassigned`, href: "/admin/support" });
  }
  if (can(r, "leads:read")) {
    const mine = count(
      "SELECT COUNT(*) c FROM follow_ups f JOIN leads l ON l.id = f.lead_id WHERE f.status = 'pending' AND f.due_at < ? AND l.assigned_to = ? AND l.stage NOT IN ('won','lost')",
      [new Date().toISOString(), actor.userId ?? "-"],
    );
    if (mine) items.push({ id: "followups", severity: "medium", title: `${mine} of your follow-ups are overdue`, href: "/admin/leads?sort=follow_up_asc" });
  }
  if (can(r, "trips:read_all")) {
    const pending = count("SELECT COUNT(*) c FROM booking_handoffs WHERE ops_status = 'pending'");
    if (pending) items.push({ id: "handoffs", severity: "info", title: `${pending} booking request${pending > 1 ? "s" : ""} awaiting review`, href: "/admin/bookings" });
  }
  const approvals = listAiActions({ status: "pending", actorUserId: r === "admin" ? undefined : (actor.userId ?? "-"), limit: 50 }).length;
  if (approvals) items.push({ id: "approvals", severity: "medium", title: `${approvals} AI action${approvals > 1 ? "s" : ""} awaiting your approval`, href: "/admin/command-center" });

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  return {
    items,
    ai: {
      mode: getAiConfig().mode,
      requestsLastHour: count("SELECT COUNT(*) c FROM usage_records WHERE created_at >= ?", [hourAgo]),
      liveRequestsLastHour: count("SELECT COUNT(*) c FROM usage_records WHERE created_at >= ? AND provider = 'openai'", [hourAgo]),
      toolCallsLastHour: count("SELECT COUNT(*) c FROM ai_actions WHERE created_at >= ?", [hourAgo]),
      failuresToday: count("SELECT COUNT(*) c FROM usage_records WHERE created_at >= ? AND outcome IN ('error','fallback','rate_limited')", [dayStart.toISOString()]),
      pendingApprovals: approvals,
    },
  };
}
