"use client";

import { useEffect, useMemo, useState } from "react";
import {
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
import { Label } from "@/components/ui/input";
import { convert } from "@/lib/fx";
import { Property, Scenario, ScenarioSchema, StockHolding, propertyEquity, vestedSharesAt } from "@/lib/models";
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

/** Compact axis labels using Intl: 850 → "850", 12k → "12K", 1.2M, 85M, 1.2B.
 *  Switches K → M at 1,000,000 and M → B at 1,000,000,000, exactly as
 *  asked. Trailing zeros are trimmed (e.g. "85M", not "85.0M"). */
const compactFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});
function compactNumber(v: number): string {
  return compactFormatter.format(v);
}

function fallbackScenario(): Scenario {
  return ScenarioSchema.parse({
    id: "fallback",
    name: "Default base case",
    description: "Auto-generated default — 8% stocks, 4% property, 5y.",
    horizon_years: 5,
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
    // Vested shares are realised. No second-trigger logic.
    const vested = vestedSharesAt(h, today);
    const valNative = vested * h.current_share_price;
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
    // Today realised (vested × current price), in target currency
    const vestedToday = vestedSharesAt(h, today);
    const realisedNative = vestedToday * h.current_share_price;
    const realised = convert(realisedNative, h.currency, args.ccy, args.settings);

    // Horizon total = all granted shares × projected price
    const v = projectStockValueAt(h, args.scenario, horizon, args.ccy, args.settings);
    const horizonTotal = v.liquid + v.unvested;

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

  const [selectedIds, setSelectedIds] = useState<string[]>(() => scenarios.map((s) => s.id));
  // If scenarios change after load (e.g. data hydrates), select any newly-added ones too
  useEffect(() => {
    setSelectedIds((prev) => {
      const known = new Set(prev);
      const allIds = scenarios.map((s) => s.id);
      const everSelected = allIds.every((id) => known.has(id));
      // Only auto-add if previously everything was selected — don't fight a deliberate
      // user de-selection.
      if (everSelected || prev.length === 0) return allIds;
      return prev;
    });
  }, [scenarios]);
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

  const toggleScenario = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allSelected = selectedIds.length === scenarios.length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Sticky toolbar — stays visible as the user scrolls the page */}
      <div className="sticky top-[44px] sm:top-[52px] z-20 -mx-3 sm:-mx-6 px-3 sm:px-6 py-2 bg-background/95 backdrop-blur border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Projections</h1>
          <CurrencySelector />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Label className="text-xs text-muted-foreground mr-1">Scenarios</Label>
          <button
            type="button"
            onClick={() => setSelectedIds(allSelected ? [] : scenarios.map((s) => s.id))}
            className="rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
          >
            {allSelected ? "Clear" : "All"}
          </button>
          {scenarios.map((s) => {
            const on = selectedIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleScenario(s.id)}
                className={
                  on
                    ? "rounded-full border border-primary bg-primary text-primary-foreground px-2.5 py-1 text-[11px] font-medium"
                    : "rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                }
              >
                {s.name}
              </button>
            );
          })}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Net worth" valueNum={totalToday} ccy={ccy} settings={settings} />
            <Kpi label="Vested equity" valueNum={liquidToday} ccy={ccy} settings={settings} />
            <Kpi label="Unvested" valueNum={unvestedToday} ccy={ccy} settings={settings} />
            <Kpi label="Property" valueNum={propertyToday} ccy={ccy} settings={settings} />
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
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={compactNumber} />
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

          <NestedAllocationCard
            ccy={ccy}
            horizonYears={chosen[0]?.horizon_years ?? 0}
            scenarioName={chosen[0]?.name ?? "—"}
            realised={realisedPie}
            coming={comingPie}
            realisedTotal={realisedTotal}
            comingTotal={comingTotal}
          />
        </>
      ) : null}

      {loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
    </div>
  );
}

function Kpi({
  label,
  valueNum,
  ccy,
  settings,
}: {
  label: string;
  valueNum: number;
  ccy: string;
  settings: ReturnType<typeof useData>["data"]["settings"];
}) {
  // Mirror the home-page logic: secondary = settings' configured secondary,
  // unless the user is already viewing in that currency (then swap to primary).
  const secondary = ccy === settings.secondary_currency
    ? settings.primary_currency
    : settings.secondary_currency;
  const rates = settings.fx_rates ?? {};
  const haveRates = secondary !== ccy && Boolean(rates[ccy]) && Boolean(rates[secondary]);
  const inSecondary = haveRates ? convert(valueNum, ccy, secondary, settings) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-[11px]">{label}</CardDescription>
        <CardTitle className="text-lg sm:text-xl tabular-nums">
          {formatMoney(valueNum, ccy)}
        </CardTitle>
      </CardHeader>
      {inSecondary !== null ? (
        <CardContent className="pt-0 text-[11px] text-foreground/70 tabular-nums">
          ≈ {formatMoney(inSecondary, secondary)}
        </CardContent>
      ) : null}
    </Card>
  );
}

type Slice = { name: string; value: number };

// Two distinct color families. Inner ring uses the first shade of each;
// outer ring picks subsequent shades for each asset within that family.
const TODAY_COLORS = ["#15803d", "#16a34a", "#22c55e", "#4ade80", "#86efac", "#bbf7d0", "#dcfce7"];
const COMING_COLORS = ["#075985", "#0284c7", "#0ea5e9", "#38bdf8", "#7dd3fc", "#bae6fd", "#dbeafe"];

/** Custom label that writes name + a big bold % in the middle of each inner
 *  pie slice. White fill with a thin dark stroke (paint-order:stroke) keeps
 *  it legible on any background colour. */
function renderInnerLabel(props: {
  cx?: number; cy?: number; midAngle?: number; innerRadius?: number; outerRadius?: number;
  percent?: number; name?: string;
}) {
  const { cx = 0, cy = 0, midAngle = 0, innerRadius = 0, outerRadius = 0, percent = 0, name = "" } = props;
  if (percent < 0.03) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  const textStyle: React.CSSProperties = {
    paintOrder: "stroke",
    stroke: "rgba(0,0,0,0.45)",
    strokeWidth: 3,
    strokeLinejoin: "round",
  };
  return (
    <g style={{ pointerEvents: "none" }}>
      <text
        x={x}
        y={y - 12}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={13}
        fontWeight={700}
        style={textStyle}
      >
        {name}
      </text>
      <text
        x={x}
        y={y + 12}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={26}
        fontWeight={900}
        style={textStyle}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    </g>
  );
}

function NestedAllocationCard({
  ccy,
  horizonYears,
  scenarioName,
  realised,
  coming,
  realisedTotal,
  comingTotal,
}: {
  ccy: string;
  horizonYears: number;
  scenarioName: string;
  realised: Slice[];
  coming: Slice[];
  realisedTotal: number;
  comingTotal: number;
}) {
  const grandTotal = realisedTotal + comingTotal;
  const empty = grandTotal === 0;

  // Sort each section by descending value for readable slice order
  const todaySorted = [...realised].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const comingSorted = [...coming].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);

  // INNER ring: the headline split — only two slices.
  // Both pies' values must sum to grandTotal so arcs align between rings.
  const innerData = [
    { name: "Today", value: realisedTotal, fill: TODAY_COLORS[0] },
    { name: "Coming", value: comingTotal, fill: COMING_COLORS[0] },
  ].filter((d) => d.value > 0);

  // OUTER ring: today's assets first (so their arcs sit under the today
  // inner slice), then coming's assets — each tagged with its bucket so
  // tooltip/legend can show "ACME (today)" vs "ACME (coming)".
  type OuterSlice = { name: string; value: number; fill: string; bucket: "today" | "coming" };
  const outerData: OuterSlice[] = [
    ...todaySorted.map((s, i) => ({
      name: s.name,
      value: s.value,
      fill: TODAY_COLORS[(i + 1) % TODAY_COLORS.length],
      bucket: "today" as const,
    })),
    ...comingSorted.map((s, i) => ({
      name: s.name,
      value: s.value,
      fill: COMING_COLORS[(i + 1) % COMING_COLORS.length],
      bucket: "coming" as const,
    })),
  ];

  const realisedPct = grandTotal > 0 ? (realisedTotal / grandTotal) * 100 : 0;
  const comingPct = grandTotal > 0 ? (comingTotal / grandTotal) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Wealth allocation — today vs +{horizonYears}y · {scenarioName} ({ccy})
        </CardTitle>
        <CardDescription className="text-[11px]">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: TODAY_COLORS[0] }} />
            <b>Today</b> {realisedPct.toFixed(0)}%
          </span>{" "}
          ·{" "}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: COMING_COLORS[0] }} />
            <b>Coming ({horizonYears}y)</b> {comingPct.toFixed(0)}%
          </span>
          {" "}— the inner ring is the headline split; the outer ring breaks each side down by asset.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Nothing realised today and no future gains projected. Add holdings or pick a different scenario.
          </p>
        ) : (
          <div className="h-[360px] w-full">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={innerData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={0}
                  outerRadius={70}
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                  label={renderInnerLabel}
                  labelLine={false}
                >
                  {innerData.map((s, i) => (
                    <Cell key={`i-${i}`} fill={s.fill} stroke="#fff" strokeWidth={2} />
                  ))}
                </Pie>
                <Pie
                  data={outerData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={140}
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                  label={(e: { percent?: number; name?: string }) =>
                    (e.percent ?? 0) > 0.04 ? `${e.name}` : ""
                  }
                >
                  {outerData.map((s, i) => (
                    <Cell key={`o-${i}`} fill={s.fill} stroke="#fff" strokeWidth={1} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatMoney(value, ccy)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          <b>Today</b> per asset = vested shares past any second trigger × current price, plus property equity.{" "}
          <b>Coming</b> per asset = the gap between the asset&apos;s value at horizon (in this scenario) and what&apos;s realised today, so it bundles future vesting, post-trigger unlocks, and price growth.
        </p>
      </CardContent>
    </Card>
  );
}
