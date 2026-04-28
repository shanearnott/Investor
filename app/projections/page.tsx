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

import { CurrencySelector } from "@/components/currency-selector";
import { useData } from "@/components/data-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { convert } from "@/lib/fx";
import { Property, Scenario, ScenarioSchema, StockHolding, propertyEquity, vestedSharesAt, parseISO } from "@/lib/models";
import {
  buildNetWorthSeries,
  projectPropertyValueAt,
  projectStockValueAt,
} from "@/lib/projections";
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

/** Realised wealth today, by asset, in target currency. */
function realisedTodayByAsset(args: {
  holdings: StockHolding[];
  properties: Property[];
  settings: ReturnType<typeof useData>["data"]["settings"];
  ccy: string;
}): { name: string; value: number }[] {
  const out: { name: string; value: number }[] = [];
  const today = new Date();
  for (const h of args.holdings) {
    // Only count shares that are vested AND past second trigger if applicable
    const vested = vestedSharesAt(h, today);
    const isDouble = h.equity_type === "RSU (double trigger)";
    let liquid = vested;
    if (isDouble && h.second_trigger_date) {
      const tdate = parseISO(h.second_trigger_date);
      if (tdate && today < tdate) liquid = 0;
    }
    const valNative = liquid * h.current_share_price;
    const v = convert(valNative, h.currency, args.ccy, args.settings);
    if (v > 0) out.push({ name: h.ticker || h.company_name || h.id, value: Math.round(v) });
  }
  for (const p of args.properties) {
    const valNative = propertyEquity(p);
    const v = convert(valNative, p.currency, args.ccy, args.settings);
    if (v > 0) out.push({ name: `${p.name} (property)`, value: Math.round(v) });
  }
  return out;
}

/** Wealth coming over the horizon, by asset, in target currency.
 *  = (asset value at horizon, including unvested + future growth) − (realised today).
 */
function comingByAsset(args: {
  holdings: StockHolding[];
  properties: Property[];
  scenario: Scenario;
  settings: ReturnType<typeof useData>["data"]["settings"];
  ccy: string;
}): { name: string; value: number }[] {
  const out: { name: string; value: number }[] = [];
  const today = new Date();
  const horizon = new Date();
  horizon.setUTCFullYear(horizon.getUTCFullYear() + args.scenario.horizon_years);

  for (const h of args.holdings) {
    // Today realised (in target ccy)
    const vestedToday = vestedSharesAt(h, today);
    const isDouble = h.equity_type === "RSU (double trigger)";
    let liquidToday = vestedToday;
    if (isDouble && h.second_trigger_date) {
      const tdate = parseISO(h.second_trigger_date);
      if (tdate && today < tdate) liquidToday = 0;
    }
    const realisedNative = liquidToday * h.current_share_price;
    const realised = convert(realisedNative, h.currency, args.ccy, args.settings);

    // Horizon total value (all granted shares × projected price)
    const v = projectStockValueAt(h, args.scenario, horizon, args.ccy, args.settings);
    const horizonTotal = v.liquid + v.illiquid_vested + v.unvested;

    const coming = horizonTotal - realised;
    if (coming > 0) out.push({ name: h.ticker || h.company_name || h.id, value: Math.round(coming) });
  }
  for (const p of args.properties) {
    const realisedNative = propertyEquity(p);
    const realised = convert(realisedNative, p.currency, args.ccy, args.settings);
    const v = projectPropertyValueAt(p, args.scenario, horizon, args.ccy, args.settings);
    const coming = v.equity - realised;
    if (coming > 0) out.push({ name: `${p.name} (property)`, value: Math.round(coming) });
  }
  return out;
}

export default function ProjectionsPage() {
  const { data, displayCurrency, loading } = useData();
  const settings = data.settings;
  const scenarios = data.scenarios.length ? data.scenarios : [fallbackScenario()];

  const [selectedIds, setSelectedIds] = useState<string[]>([scenarios[0]?.id]);
  const chosen = scenarios.filter((s) => selectedIds.includes(s.id));

  // Build series in displayCurrency (so all chart axes/tooltips match the selector)
  const seriesByScenario = useMemo(() => {
    const out: Record<string, ReturnType<typeof buildNetWorthSeries>> = {};
    const settingsForDisplay: typeof settings = {
      ...settings,
      primary_currency: displayCurrency as typeof settings.primary_currency,
    };
    for (const sc of chosen) {
      out[sc.id] = buildNetWorthSeries({
        holdings: data.stocks,
        properties: data.properties,
        scenario: sc,
        settings: settingsForDisplay,
        config: { horizon_years: sc.horizon_years, step_months: 1 },
      });
    }
    return out;
  }, [chosen, data.stocks, data.properties, settings, displayCurrency]);

  const ccy = displayCurrency;

  // KPIs from row 0 of any selected scenario
  const firstSeries = chosen[0] ? seriesByScenario[chosen[0].id] : [];
  const todayRow = firstSeries[0];
  const totalToday = todayRow?.total ?? 0;
  const liquidToday = todayRow?.liquid_equity_total ?? 0;
  const illiquidToday = todayRow?.illiquid_equity_total ?? 0;
  const unvestedToday = todayRow?.unvested_equity_total ?? 0;
  const propertyToday = todayRow?.property_equity_total ?? 0;

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

  const sandData = (chosen[0] ? seriesByScenario[chosen[0].id] : []).map((r) => ({
    date: r.date,
    Liquid: Math.round(r.liquid_equity_total),
    "Pre-trigger": Math.round(r.illiquid_equity_total),
    Unvested: Math.round(r.unvested_equity_total),
    Property: Math.round(r.property_equity_total),
  }));

  const realisedPie = realisedTodayByAsset({
    holdings: data.stocks, properties: data.properties, settings, ccy,
  });
  const comingPie = chosen[0]
    ? comingByAsset({
        holdings: data.stocks, properties: data.properties,
        scenario: chosen[0], settings, ccy,
      })
    : [];

  const realisedTotal = realisedPie.reduce((s, x) => s + x.value, 0);
  const comingTotal = comingPie.reduce((s, x) => s + x.value, 0);

  const noData = data.stocks.length === 0 && data.properties.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Projections</h1>
        <div className="flex flex-wrap items-center gap-3">
          <CurrencySelector />
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
            <Kpi label={`Net worth (${ccy})`} value={formatMoney(totalToday, ccy)} />
            <Kpi label="Liquid equity" value={formatMoney(liquidToday, ccy)} />
            <Kpi label="Pre-trigger" value={formatMoney(illiquidToday, ccy)} />
            <Kpi label="Unvested" value={formatMoney(unvestedToday, ccy)} />
            <Kpi label="Property" value={formatMoney(propertyToday, ccy)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Net worth over time ({ccy})</CardTitle>
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
                      formatter={(v: number) => formatMoney(v, ccy)}
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
              <CardTitle>Composition over time — {chosen[0]?.name} ({ccy})</CardTitle>
              <CardDescription>Liquid · pre-trigger vested · unvested · property equity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer>
                  <AreaChart data={sandData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={50} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatNumber(v / 1000) + "k"} />
                    <Tooltip formatter={(v: number) => formatMoney(v, ccy)} labelFormatter={(l) => `As of ${l}`} />
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
            <PieCard
              title={`Realised wealth today (${ccy})`}
              subtitle={`What you'd have if you liquidated everything accessible right now. Total: ${formatMoney(realisedTotal, ccy)}`}
              data={realisedPie}
              ccy={ccy}
              empty="Nothing realised yet — your equity is all pre-trigger or unvested."
            />
            <PieCard
              title={`Coming over ${chosen[0]?.horizon_years ?? 0}y · ${chosen[0]?.name} (${ccy})`}
              subtitle={`Locked vesting + price/value growth between now and the horizon. Total: ${formatMoney(comingTotal, ccy)}`}
              data={comingPie}
              ccy={ccy}
              empty="No future gains projected by this scenario."
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            <b>Realised today</b> = vested shares past any second trigger × current price + property equity. <b>Coming</b> = the gap between an asset&apos;s value at the horizon (in the chosen scenario) and what&apos;s realised today. So &quot;Coming&quot; for an RSU includes shares that will vest, shares that will pass their second trigger, and price growth on all of them.
          </p>
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
  subtitle,
  data,
  ccy,
  empty,
}: {
  title: string;
  subtitle?: string;
  data: { name: string; value: number }[];
  ccy: string;
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {subtitle ? <CardDescription className="text-[11px]">{subtitle}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{empty}</p>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                  label={(e: { percent?: number }) => `${(((e.percent ?? 0) * 100)).toFixed(0)}%`}
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatMoney(v, ccy)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
