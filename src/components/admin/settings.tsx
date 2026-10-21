"use client";

import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { api, errorMessage, useApi } from "@/lib/client/api";
import { titleCase } from "@/lib/client/format";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, SkeletonRows } from "@/components/ui";

interface SettingsOverview {
  canManage: boolean;
  ai: { mode: "live" | "mock"; reason: string; routineModel: string; advancedModel: string; realtimeModel: string; limits: { maxOutputTokens: number; timeoutMs: number; maxRetries: number }; apiKeyConfigured: boolean };
  guardRails: { monthlyBudgetUsd: number; dailyRequestsPerActor: number; liveAiEnabled: boolean; monthToDateUsd: number };
  integrations: { name: string; status: string; detail: string }[];
  roles: { role: string; label: string; permissions: string[] }[];
  permissions: string[];
  data: { total: number; demo: number; live: number };
}

const STATUS_TONE: Record<string, "green" | "amber" | "neutral" | "red" | "blue"> = { live: "green", mock: "amber", demo: "amber", unavailable: "neutral", "not connected": "neutral" };

export function SettingsPage() {
  const { data, error, loading, reload } = useApi<SettingsOverview>("/api/settings/overview");
  const [draft, setDraft] = useState<{ monthlyBudgetUsd?: string; dailyRequestsPerActor?: string; liveAiEnabled?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <SkeletonRows rows={10} />;
  if (!data) return null;
  const g = data.guardRails;

  return (
    <>
      <PageHeader title="Settings" description="AI configuration, cost guard rails, integrations and role permissions for this workspace. Secrets are never shown." />
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="AI configuration" description="Read from server environment variables" action={<Badge tone={data.ai.mode === "live" ? "green" : "amber"}>{data.ai.mode === "live" ? "Live AI" : "Mock mode"}</Badge>} />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
            <Item label="Status">{data.ai.reason}</Item>
            <Item label="OPENAI_API_KEY">{data.ai.apiKeyConfigured ? "Configured (server-side only)" : "Not configured"}</Item>
            <Item label="Routine model (OPENAI_MODEL)">
              <code>{data.ai.routineModel}</code>
            </Item>
            <Item label="Advanced model (itinerary only)">
              <code>{data.ai.advancedModel}</code>
            </Item>
            <Item label="Realtime voice model">
              <code>{data.ai.realtimeModel}</code>
            </Item>
            <Item label="Limits per call">
              {data.ai.limits.maxOutputTokens} output tokens · {data.ai.limits.timeoutMs / 1000}s timeout · {data.ai.limits.maxRetries} retries
            </Item>
          </dl>
          {data.canManage && <AiConnectionCheck />}
        </Card>

        <Card>
          <CardHeader title="Cost guard rails" description={`Estimated spend this month: $${g.monthToDateUsd.toFixed(4)} of $${g.monthlyBudgetUsd}`} />
          <form
            className="space-y-4 p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMsg(null);
              try {
                await api("/api/admin/settings", {
                  method: "PATCH",
                  body: {
                    ...(draft.monthlyBudgetUsd !== undefined && { monthlyBudgetUsd: Number(draft.monthlyBudgetUsd) }),
                    ...(draft.dailyRequestsPerActor !== undefined && { dailyRequestsPerActor: Number(draft.dailyRequestsPerActor) }),
                    ...(draft.liveAiEnabled !== undefined && { liveAiEnabled: draft.liveAiEnabled }),
                  },
                });
                setDraft({});
                reload();
                setMsg({ tone: "green", text: "Guard rails saved and audited." });
              } catch (err) {
                setMsg({ tone: "red", text: errorMessage(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {!data.canManage && <Alert tone="blue">Only administrators can change these settings.</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Monthly AI budget (USD)" htmlFor="set-budget" hint="Live calls stop and fall back to rules once reached">
                <Input id="set-budget" type="number" min={0} step="0.5" disabled={!data.canManage} value={draft.monthlyBudgetUsd ?? String(g.monthlyBudgetUsd)} onChange={(e) => setDraft({ ...draft, monthlyBudgetUsd: e.target.value })} />
              </Field>
              <Field label="Daily AI requests per user / session" htmlFor="set-daily">
                <Input id="set-daily" type="number" min={0} disabled={!data.canManage} value={draft.dailyRequestsPerActor ?? String(g.dailyRequestsPerActor)} onChange={(e) => setDraft({ ...draft, dailyRequestsPerActor: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={!data.canManage} checked={draft.liveAiEnabled ?? g.liveAiEnabled} onChange={(e) => setDraft({ ...draft, liveAiEnabled: e.target.checked })} /> Allow live AI calls (kill switch)
            </label>
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            {data.canManage && (
              <Button type="submit" loading={busy} disabled={!Object.keys(draft).length}>
                Save guard rails
              </Button>
            )}
          </form>
        </Card>

        <Card>
          <CardHeader title="Integrations" description="What is genuinely live versus demo in this workspace" />
          <ul className="divide-y divide-border">
            {data.integrations.map((i) => (
              <li key={i.name} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium">{i.name}</p>
                  <p className="text-muted">{i.detail}</p>
                </div>
                <Badge tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</Badge>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-5 py-3 text-xs text-muted">
            Records: {data.data.live} created live in this workspace · {data.data.demo} seeded demo records (labelled across the app).
          </p>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader title="Roles & permissions" description="Enforced on the server for every API call and AI tool" />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-3 py-2 font-medium">Permission</th>
                  {data.roles.map((r) => (
                    <th key={r.role} className="px-2 py-2 text-center font-medium">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.permissions.map((p) => (
                  <tr key={p} className="border-b border-border/60">
                    <td className="px-3 py-1.5 font-mono">{p}</td>
                    {data.roles.map((r) => (
                      <td key={r.role} className="px-2 py-1.5 text-center">
                        {r.permissions.includes(p) ? <Check className="mx-auto h-3.5 w-3.5 text-accent" aria-label="Allowed" /> : <Minus className="mx-auto h-3.5 w-3.5 text-slate-300" aria-label="Not allowed" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-muted">Customers can only access records they own. {titleCase("customer")} accounts are created by sign-up; employee roles are provisioned by admins.</p>
        </Card>
      </div>
      {data.canManage && <PerformancePanel />}
    </>
  );
}

interface PerfData {
  since: string;
  routes: { route: string; count: number; p50: number; p95: number; avgDbMs: number; avgQueries: number; errorRate: number }[];
  cache: { name: string; hits: number; misses: number; hitRate: number }[];
  ai: { category: string; provider: string; calls: number; p50LatencyMs: number; p95LatencyMs: number; failureRate: number; estCostUsd: number }[];
}

/** Measured (not estimated) API, database, cache and AI performance since the server started. */
function PerformancePanel() {
  const { data, error, reload, loading } = useApi<PerfData>("/api/admin/performance");
  return (
    <Card className="mt-5">
      <CardHeader
        title="Measured performance"
        description={data ? `Since server start (${new Date(data.since).toLocaleString("en-IN")}). Timings measured in route handlers; see docs/PERFORMANCE.md for benchmarks.` : "API, database and AI latency"}
        action={
          <Button size="sm" variant="secondary" onClick={reload} loading={loading}>
            Refresh
          </Button>
        }
      />
      {error ? (
        <p className="px-5 py-4 text-sm text-danger">{errorMessage(error)}</p>
      ) : !data ? null : (
        <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Route (slowest p95 first)</th>
                  <th className="py-2 pr-3 font-medium">Requests</th>
                  <th className="py-2 pr-3 font-medium">p50 ms</th>
                  <th className="py-2 pr-3 font-medium">p95 ms</th>
                  <th className="py-2 pr-3 font-medium">DB ms</th>
                  <th className="py-2 pr-3 font-medium">Queries</th>
                  <th className="py-2 font-medium">5xx %</th>
                </tr>
              </thead>
              <tbody>
                {data.routes.slice(0, 12).map((r) => (
                  <tr key={r.route} className="border-b border-border/60 tabular-nums">
                    <td className="py-1.5 pr-3 font-mono text-xs">{r.route}</td>
                    <td className="py-1.5 pr-3">{r.count}</td>
                    <td className="py-1.5 pr-3">{r.p50}</td>
                    <td className="py-1.5 pr-3">{r.p95}</td>
                    <td className="py-1.5 pr-3">{r.avgDbMs}</td>
                    <td className="py-1.5 pr-3">{r.avgQueries}</td>
                    <td className={r.errorRate ? "py-1.5 text-danger" : "py-1.5"}>{r.errorRate}</td>
                  </tr>
                ))}
                {!data.routes.length && (
                  <tr>
                    <td colSpan={7} className="py-3 text-muted">
                      No requests measured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="space-y-4 text-[13px]">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">AI calls (24 h)</h3>
              {data.ai.length ? (
                <ul className="mt-1 space-y-1">
                  {data.ai.map((a) => (
                    <li key={`${a.category}-${a.provider}`} className="flex justify-between gap-2">
                      <span>
                        {titleCase(a.category)} <span className="text-muted">({a.provider === "mock" ? "rules" : a.provider})</span>
                      </span>
                      <span className="tabular-nums text-muted">
                        {a.calls} · p50 {a.p50LatencyMs} ms · p95 {a.p95LatencyMs} ms · ${a.estCostUsd.toFixed(4)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted">No AI calls recorded.</p>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Cache</h3>
              {data.cache.length ? (
                data.cache.map((c) => (
                  <p key={c.name} className="mt-1 tabular-nums">
                    {c.name}: {c.hitRate}% hit rate ({c.hits} hits / {c.misses} misses)
                  </p>
                ))
              ) : (
                <p className="mt-1 text-muted">No cache lookups yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

interface AiCheckResult {
  mode: string;
  checks: { name: string; status: "passed" | "failed" | "blocked"; latencyMs: number | null; detail: string }[];
}

/** Runs the server-side live OpenAI checks (a few small, billable requests) and shows honest results. */
function AiConnectionCheck() {
  const [result, setResult] = useState<AiCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="border-t border-border px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">Verify the live connection: configuration, model access, one structured trip-planning request and one voice session.</p>
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              setResult(await api<AiCheckResult>("/api/admin/ai-check", { method: "POST" }));
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Test live AI connection
        </Button>
      </div>
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
      {result && (
        <ul className="mt-3 space-y-1.5 text-[13px]" aria-live="polite">
          {result.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-2">
              <Badge tone={c.status === "passed" ? "green" : c.status === "failed" ? "red" : "amber"}>{c.status === "passed" ? "Pass" : c.status === "failed" ? "Fail" : "Blocked"}</Badge>
              <span>
                <span className="font-medium">{c.name}</span>
                {c.latencyMs !== null && <span className="text-muted"> · {c.latencyMs} ms</span>}
                <span className="block text-xs text-muted">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
