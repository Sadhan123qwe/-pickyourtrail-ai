"use client";

import { formatMoney } from "@/lib/client/format";
import type { BudgetBreakdown } from "@/lib/client/types";
import { Alert, Badge, Card, CardHeader } from "@/components/ui";

const ROWS: { key: keyof Pick<BudgetBreakdown, "flights" | "accommodation" | "activities" | "localTransport" | "meals">; label: string }[] = [
  { key: "flights", label: "Flights" },
  { key: "accommodation", label: "Hotel" },
  { key: "activities", label: "Activities" },
  { key: "localTransport", label: "Local transport" },
  { key: "meals", label: "Meals (estimate)" },
];

/** Itemised estimate. Magnitude bars use one hue; every value is also printed as text. */
export function BudgetCard({ budget, compact }: { budget: BudgetBreakdown; compact?: boolean }) {
  const max = Math.max(...ROWS.map((r) => budget[r.key]), 1);
  const c = budget.comparison;
  return (
    <Card>
      <CardHeader title="Estimated budget" description={`${budget.travellers} traveller${budget.travellers > 1 ? "s" : ""} · all prices are estimates`} action={<Badge tone="amber">Estimate</Badge>} />
      <div className="space-y-3 p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(budget.total)}</p>
            <p className="text-xs text-muted">≈ {formatMoney(budget.perPerson)} per person</p>
          </div>
        </div>
        <table className="w-full text-sm">
          <caption className="sr-only">Budget breakdown</caption>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="w-32 py-1.5 pr-2 text-left font-normal text-muted">
                  {r.label}
                </th>
                <td className="py-1.5">
                  <div className="h-2 rounded-full bg-lavender-surface">
                    <div className="h-2 rounded-full bg-[#7656c9]" style={{ width: `${(budget[r.key] / max) * 100}%` }} />
                  </div>
                </td>
                <td className="w-28 py-1.5 pl-2 text-right tabular-nums">{formatMoney(budget[r.key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.status !== "unknown" && (
          <Alert tone={c.status === "over" ? "amber" : "green"} title={c.status === "over" ? "Over budget" : c.status === "near" ? "On budget" : "Within budget"}>
            {c.note} {c.budgetInr !== null && <>Your budget: {formatMoney(c.budgetInr)}.</>}
          </Alert>
        )}
        {!compact && (
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
            {budget.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
