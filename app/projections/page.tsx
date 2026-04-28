"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useData } from "@/components/data-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { Scenario, ScenarioSchema } from "@/lib/models";
import {
  buildNetWorthSeries,
  currentAllocationBreakdown,
  futureAllocationBreakdown,
} from "@/lib/projections";
import { convert } from "@/lib/fx";
import { formatMoney, formatNumber } from "@/lib/utils";

const PIE_COLORS = [
  "#1e3a8a", "#0e7490", "#0f766e", "#65a30d", "#ca8a04",
  "#c2410c", "#b91c1c", "#9333ea", "#7c3aed", "#0369a1",
];

const SAND_COLORS: Record<string, string> = {
  liquid_equity_total: "#16a34a",
  illiquid_equity_total: "#0ea5e9",
  unvested_equity_total: "#a3a3a3",
  property_equity_total: "#f59e0b",
};

function fallbackScenario(): Scenario {
  return ScenarioSchema.parse({
    id: "fallback",
    name: "Default base case",
    description: "Auto-generated default — 8% stocks, 4% property, 10y.",
    horizon_years: 10,
    default_stock_growth_pct: 8,
    default_property_growth_pct: 4,
    stock_overrides: {},
    property_overrides: {},
    inflation_pct: 0,
  });
}

export default function ProjectionsPage() {
  const { data, loading } = useData();
  const settings = data.settings;
  const scenarios = data.scenarios.length ? data.scenarios : [fallbackScenario()];

  const [selectedIds, setSelectedIds] = useState<string[]>([scenarios[0]?.id]);
  const chosen = scenarios.filter((s) => selectedIds.includes(s.id));

  // Build series for each chosen scenario (memoized)
  const seriesByScenario = useMemo(() => {
    const out: Record<string, ReturnType<typeof buildNetWorthSeries>> = {};
    for (const sc of chosen) {
      out[sc.id] = buildNetWorthSeries({
        holdings: data.stocks,
        properties: data.properties,
        scenario: sc,
        settings,
        config: { horizon_years: sc.horizon_years, step_months: 1 },
      });
    }
    return out;
  }, [chosen, data.stocks, data.properties, settings]);

  const primary = settings.primary_currency;
  const secondary = settings.secondary_currency;

  // KPIs from row 0 of any selected scenario
  const firstSeries = chosen[0] ? seriesByScenario[chosen[0].id] : [];
  const todayRow = firstSeries[0];
  const totalToday = todayRow?.total ?? 0;
  const liquidToday = todayRow?.liquid_equity_total ?? 0;
  const illiquidToday = todayRow?.illiquid_equity_total ?? 0;
  const unvestedToday = todayRow?.unvested_equity_total ?? 0;
  const propertyToday = todayRow?.property_equity_total ?? 0;

  // Line chart data: merge by date with one column per scenario
  const lineData = useMemo(() => {
    const dates = new Set<string>();
    for (const sc of chosen) (seriesByScenario[sc.id] ?? []).forEach((r) => dates.add(r.date));
    const sorted = Array.from(dates).sort();
    return sorted.map((date) => {
      const row: Record<string, number | string> = { date };
      for (const sc of chosen) {
        const r = (seriesByScenario[sc.id] ?? []).find((x) => x.date === date);
        if (r) row[sc.name] = Math.round(r.total);
      }
      return row;
    });
  }, [chosen, seriesByScenario]);

  // Sand chart data for first selected scenario
  const sandData = (chosen[0] ? seriesByScenario[chosen[0].id] : []).map((r) => ({
    date: r.date,
    Liquid: Math.round(r.liquid_equity_total),
    "Pre-trigger": Math.round(r.illiquid_equity_total),
    Unvested: Math.round(r.unvested_equity_total),
    Property: Math.round(r.property_equity_total),
  }));

  const cur = currentAllocationBreakdown({
    holdings: data.stocks,
    properties: data.properties,
    settings,
  });
  const fut = chosen[0]
    ? futureAllocationBreakdown({
        holdings: data.stocks,
        properties: data.properties,
        scenario: chosen[0],
        settings,
      })
    : {};

  const curPie = Object.entries(cur).map(([name, value]) => ({ name, value: Math.round(value) }));
  const futPie = Object.entries(fut).map(([name, value]) => ({ name, value: Math.round(value) }));

  const noData = data.stocks.length === 0 && data.properties.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Projections</h1>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <Label className="text-xs">Scenarios</Label>
          <Select
            multiple
            className="h-auto min-h-10"
            value={selectedIds}
            onChange={(e) =>
              setSelectedIds(Array.from(e.target.selectedOptions, (o) => o.value))
            }
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {noData ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Add at least one stock or property on the <b>Investments</b> page first.
          </CardContent>
        </Card>
      ) : null}

      {!noData ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Kpi label={`Net worth (${primary})`} value={formatMoney(totalToday, primary)} sub={`≈ ${formatMoney(convert(totalToday, primary, secondary, settings), secondary)}`} />
            <Kpi label="Liquid equity" value={formatMoney(liquidToday, primary)} />
            <Kpi label="Pre-trigger" value={formatMoney(illiquidToday, primary)} />
            <Kpi label="Unvested" value={formatMoney(unvestedToday, primary)} />
            <Kpi label="Property" value={formatMoney(propertyToday, primary)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Net worth over time</CardTitle>
              <CardDescription>
                {chosen.map((s) => s.name).join(" · ") || "—"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer>
                  <LineChart data={lineData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={50} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumber(v / 1000) + "k"} />
                    <Tooltip
                      formatter={(v: number) => formatMoney(v, primary)}
                      labelFormatter={(l) => `As of ${l}`}
                    />
                    <Legend />
                    {chosen.map((s, i) => (
                      <Line
                        key={s.id}
                        type="monotone"
                        dataKey={s.name}
                        stroke={PIE_COLORS[i % PIE_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Composition over time — {chosen[0]?.name}</CardTitle>
              <CardDescription>Liquid · pre-trigger vested · unvested · property equity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer>
                  <AreaChart data={sandData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={50} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumber(v / 1000) + "k"} />
                    <Tooltip formatter={(v: number) => formatMoney(v, primary)} labelFormatter={(l) => `As of ${l}`} />
                    <Legend />
                    <Area type="monotone" dataKey="Liquid" stackId="1" stroke={SAND_COLORS.liquid_equity_total} fill={SAND_COLORS.liquid_equity_total} fillOpacity={0.7} />
                    <Area type="monotone" dataKey="Pre-trigger" stackId="1" stroke={SAND_COLORS.illiquid_equity_total} fill={SAND_COLORS.illiquid_equity_total} fillOpacity={0.7} />
                    <Area type="monotone" dataKey="Unvested" stackId="1" stroke={SAND_COLORS.unvested_equity_total} fill={SAND_COLORS.unvested_equity_total} fillOpacity={0.7} />
                    <Area type="monotone" dataKey="Property" stackId="1" stroke={SAND_COLORS.property_equity_total} fill={SAND_COLORS.property_equity_total} fillOpacity={0.7} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <PieCard title={`Current value (${primary})`} data={curPie} primary={primary} empty="No vested value yet." />
            <PieCard
              title={`Projected at ${chosen[0]?.horizon_years ?? 0}y · ${chosen[0]?.name}`}
              data={futPie}
              primary={primary}
              empty="No projected value."
            />
          </div>
        </>
      ) : null}

      {loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-[11px]">{label}</CardDescription>
        <CardTitle className="text-lg sm:text-xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub ? (
        <CardContent className="pt-0 text-[11px] text-muted-foreground">{sub}</CardContent>
      ) : null}
    </Card>
  );
}

function PieCard({
  title,
  data,
  primary,
  empty,
}: {
  title: string;
  data: { name: string; value: number }[];
  primary: string;
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{empty}</p>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} label={(e: { percent?: number }) => `${(((e.percent ?? 0) * 100)).toFixed(0)}%`}>
                  {data.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatMoney(v, primary)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
