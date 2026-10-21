"use client";

import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Validated categorical order (fixed, never cycled), derived from the brand:
 * lavender-violet, amber, blue, chartreuse-olive. All pass lightness, chroma,
 * CVD and 3:1 contrast checks on white. Tomato is reserved for alerts.
 */
export const SERIES = ["#7656c9", "#d0661a", "#0a84b8", "#6b9200"] as const;
const AXIS = { fontSize: 12, fill: "#696a91" };
const GRID = "#eee8f7";

const tooltipStyle = {
  contentStyle: { borderRadius: 8, border: "1px solid #e6ddf5", fontSize: 12, boxShadow: "0 8px 28px rgba(60,42,100,0.1)" },
  labelStyle: { color: "#191936", fontWeight: 600 },
  itemStyle: { color: "#191936" },
};

function shortDate(d: string) {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
}

export function TimeSeriesChart({ data, series, height = 260 }: { data: Record<string, number | string>[]; series: { key: string; label: string }[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`Line chart of ${series.map((s) => s.label).join(", ")} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={40} />
          <Tooltip {...tooltipStyle} labelFormatter={(l) => shortDate(String(l))} cursor={{ stroke: "#a99bcf", strokeDasharray: "3 3" }} />
          {series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "#191936" }} />}
          {series.map((s, i) => (
            <Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={SERIES[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for magnitude by category (single hue). */
export function HorizontalBars({ data, labelKey, valueKey, height, valueLabel }: { data: Record<string, number | string>[]; labelKey: string; valueKey: string; height?: number; valueLabel: string }) {
  const h = height ?? Math.max(120, data.length * 36 + 20);
  return (
    <div style={{ height: h }} role="img" aria-label={`Bar chart of ${valueLabel} by ${labelKey}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey={labelKey} tick={AXIS} tickLine={false} axisLine={false} width={130} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(203,179,235,0.18)" }} formatter={(v) => [v, valueLabel]} />
          <Bar dataKey={valueKey} name={valueLabel} fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={22}>
            <LabelList dataKey={valueKey} position="right" style={{ fontSize: 12, fill: "#191936" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Funnel as ordered horizontal bars with step conversion printed as text. */
export function Funnel({ steps }: { steps: { stage: string; value: number }[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <ol className="space-y-3" aria-label="Conversion funnel">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const rate = prev ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.stage}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-slate-700">{s.stage}</span>
              <span className="tabular-nums">
                <span className="font-semibold">{s.value}</span>
                {rate !== null && <span className="ml-2 text-xs text-muted">{rate}% of previous</span>}
              </span>
            </div>
            <div className="h-3 rounded-full bg-lavender-surface">
              <div className="h-3 rounded-full bg-[#7656c9]" style={{ width: `${Math.max((s.value / max) * 100, s.value ? 2 : 0)}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
