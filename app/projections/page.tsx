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
import { Input, Label, Select } from "@/components/ui/input";
import { convert } from "@/lib/fx";
import { Property, Scenario, ScenarioSchema, StockHolding } from "@/lib/models";
import {
  buildNetWorthSeries,
  projectPropertyValueAt,
  projectStockValueAt,
} from "@/lib/projections";
import { formatMoney, formatNumber } from "@/lib/utils";

const HORIZON_OPTIONS = [2.5, 5, 10, 15, 20] as const;
type HorizonYears = (typeof HORIZON_OPTIONS)[number];

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

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** YYYY-MM-DD → "Mmm-YY" (e.g. "2026-05-01" → "May-26"). Falls back to
 *  the raw input if it doesn't match the expected ISO shape. */
function formatMmmYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) return iso;
  const monthIdx = Number(m[2]) - 1;
  const yy = m[1].slice(2);
  if (monthIdx < 0 || monthIdx > 11) return iso;
  return `${MONTH_SHORT[monthIdx]}-${yy}`;
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

/** Realised wealth at a given date, by asset, in target currency.
 *  "Realised" = vested shares × projected price (or equity for property),
 *  i.e. what would actually be in your hands on that date under the scenario.
 *  When asOf is today, projection is a no-op and this collapses to the live
 *  snapshot. */
function realisedAtDateByAsset(args: {
  holdings: StockHolding[];
  properties: Property[];
  scenario: Scenario;
  settings: ReturnType<typeof useData>["data"]["settings"];
  asOf: Date;
  ccy: string;
}): Slice[] {
  const out: Slice[] = [];
  const settingsForCcy: typeof args.settings = {
    ...args.settings,
    primary_currency: args.ccy as typeof args.settings.primary_currency,
  };
  for (const h of args.holdings) {
    const v = projectStockValueAt(h, args.scenario, args.asOf, args.ccy, settingsForCcy);
    if (v.liquid > 0) {
      out.push({ name: h.ticker || h.company_name || h.id, value: Math.round(v.liquid), kind: "stock" });
    }
  }
  for (const p of args.properties) {
    const v = projectPropertyValueAt(p, args.scenario, args.asOf, args.ccy, settingsForCcy);
    if (v.equity > 0) {
      out.push({ name: `${p.name} (property)`, value: Math.round(v.equity), kind: "property" });
    }
  }
  return out;
}

/** Wealth coming between asOf and horizon, by asset, in target currency.
 *  = (asset value at horizon, including unvested + future growth) − (realised at asOf).
 *  Negative values are clamped to 0 (e.g. if asOf > horizon).
 */
function comingByAsset(args: {
  holdings: StockHolding[];
  properties: Property[];
  scenario: Scenario;
  settings: ReturnType<typeof useData>["data"]["settings"];
  asOf: Date;
  ccy: string;
  horizonYears: number;
}): Slice[] {
  const out: Slice[] = [];
  const horizon = new Date();
  horizon.setUTCMonth(horizon.getUTCMonth() + Math.round(args.horizonYears * 12));
  const settingsForCcy: typeof args.settings = {
    ...args.settings,
    primary_currency: args.ccy as typeof args.settings.primary_currency,
  };

  for (const h of args.holdings) {
    const realisedNow = projectStockValueAt(h, args.scenario, args.asOf, args.ccy, settingsForCcy).liquid;
    const v = projectStockValueAt(h, args.scenario, horizon, args.ccy, settingsForCcy);
    const horizonTotal = v.liquid + v.unvested;
    const coming = Math.max(0, horizonTotal - realisedNow);
    if (coming > 0) out.push({ name: h.ticker || h.company_name || h.id, value: Math.round(coming), kind: "stock" });
  }
  for (const p of args.properties) {
    const realisedNow = projectPropertyValueAt(p, args.scenario, args.asOf, args.ccy, settingsForCcy).equity;
    const v = projectPropertyValueAt(p, args.scenario, horizon, args.ccy, settingsForCcy);
    const coming = Math.max(0, v.equity - realisedNow);
    if (coming > 0) out.push({ name: `${p.name} (property)`, value: Math.round(coming), kind: "property" });
  }
  return out;
}

export default function ProjectionsPage() {
  const { data, displayCurrency, loading } = useData();
  const settings = data.settings;
  const scenarios = data.scenarios.length ? data.scenarios : [fallbackScenario()];

  // Default to the first scenario only — multi-select is opt-in via the chips.
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    scenarios[0] ? [scenarios[0].id] : [],
  );
  // After data hydrates, if our selection still points at scenarios that no
  // longer exist (e.g. we were holding the fallback id), fall back to the
  // new first scenario. Don't fight a deliberate user selection.
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(scenarios.map((s) => s.id));
      const stillValid = prev.filter((id) => validIds.has(id));
      if (stillValid.length > 0) return stillValid;
      return scenarios[0] ? [scenarios[0].id] : [];
    });
  }, [scenarios]);
  const chosen = scenarios.filter((s) => selectedIds.includes(s.id));

  // Shared horizon for both the line chart and the wealth-allocation pie.
  // Decoupled from each scenario's `horizon_years` (which still drives
  // target_share_price → implied annual growth rate).
  const [horizonYears, setHorizonYears] = useState<HorizonYears>(5);

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
        config: { horizon_years: horizonYears, step_months: 1 },
      });
    }
    return out;
  }, [chosen, data.stocks, data.properties, settings, displayCurrency, horizonYears]);

  const ccy = displayCurrency;

  // KPIs from row 0 of any selected scenario
  const firstSeries = chosen[0] ? seriesByScenario[chosen[0].id] : [];
  const todayRow = firstSeries[0];
  const totalToday = todayRow?.total ?? 0;
  const liquidToday = todayRow?.liquid_equity_total ?? 0;
  const unvestedToday = todayRow?.unvested_equity_total ?? 0;
  const propertyToday = todayRow?.property_equity_total ?? 0;

  // For each scenario the chart shows two lines: total (smooth, vested + unvested
  // + property — only changes with price) and "{name} vested" (vested + property
  // only — visibly steps up at every vest event so the user can see vesting
  // actually showing up).
  const lineData = useMemo(() => {
    const dates = new Set<string>();
    for (const sc of chosen) (seriesByScenario[sc.id] ?? []).forEach((r) => dates.add(r.date));
    const sorted = Array.from(dates).sort();
    return sorted.map((date) => {
      const row: Record<string, number | string> = { date };
      for (const sc of chosen) {
        const r = (seriesByScenario[sc.id] ?? []).find((x) => x.date === date);
        if (r) {
          row[sc.name] = Math.round(r.total);
          row[`${sc.name} vested`] = Math.round(r.liquid_equity_total + r.property_equity_total);
        }
      }
      return row;
    });
  }, [chosen, seriesByScenario]);

  // As-of date for the wealth-allocation pie chart. YYYY-MM is enough — pin
  // to the 1st of the chosen month. Defaults to today; user can slide it
  // forward to see "what would the realised vs coming split look like in 2y?"
  const todayMonthISO = new Date().toISOString().slice(0, 7);
  const [asOfMonth, setAsOfMonth] = useState<string>(todayMonthISO);
  const asOfDate = useMemo(() => {
    const [y, m] = asOfMonth.split("-").map(Number);
    if (!y || !m) return new Date();
    return new Date(Date.UTC(y, m - 1, 1));
  }, [asOfMonth]);
  const isToday = asOfMonth === todayMonthISO;

  const pieScenario = chosen[0];
  const realisedPie: Slice[] = pieScenario
    ? realisedAtDateByAsset({
        holdings: data.stocks, properties: data.properties,
        scenario: pieScenario, settings, asOf: asOfDate, ccy,
      })
    : [];
  const comingPie: Slice[] = pieScenario
    ? comingByAsset({
        holdings: data.stocks, properties: data.properties,
        scenario: pieScenario, settings, asOf: asOfDate, ccy,
        horizonYears,
      })
    : [];

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
          <div className="ml-auto flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Horizon</Label>
            <Select
              value={String(horizonYears)}
              onChange={(e) => setHorizonYears(Number(e.target.value) as HorizonYears)}
              className="h-8 w-[100px] text-xs"
            >
              {HORIZON_OPTIONS.map((y) => (
                <option key={y} value={y}>{y} years</option>
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
                Solid line = total (vested + unvested + property). Dashed line = vested + property only — steps up as shares vest. {chosen.map((s) => s.name).join(" · ") || "—"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer>
                  <LineChart data={lineData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      minTickGap={50}
                      tickFormatter={formatMmmYY}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={compactNumber} />
                    <Tooltip
                      content={(props) => (
                        <LesserOfTooltip
                          active={props.active}
                          payload={props.payload as TooltipPayloadEntry[] | undefined}
                          label={props.label as string | undefined}
                          ccy={ccy}
                        />
                      )}
                    />
                    <Legend />
                    {chosen.map((s, i) => {
                      const colour = PIE_COLORS[i % PIE_COLORS.length];
                      // Order matters: draw the dashed total first, then the
                      // solid vested line on top. Where the two converge the
                      // solid line covers the dashed one, so a fully-vested
                      // tail reads as a single solid line.
                      return [
                        <Line
                          key={`${s.id}-total`}
                          type="monotone"
                          dataKey={s.name}
                          stroke={colour}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          dot={false}
                        />,
                        <Line
                          key={`${s.id}-vested`}
                          type="monotone"
                          dataKey={`${s.name} vested`}
                          stroke={colour}
                          strokeWidth={2}
                          dot={false}
                        />,
                      ];
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <NestedAllocationCard
            ccy={ccy}
            horizonYears={horizonYears}
            scenarioName={chosen[0]?.name ?? "—"}
            realised={realisedPie}
            coming={comingPie}
            asOfMonth={asOfMonth}
            setAsOfMonth={setAsOfMonth}
            isToday={isToday}
            todayMonthISO={todayMonthISO}
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

type Slice = { name: string; value: number; kind: "stock" | "property" };

type TooltipPayloadEntry = {
  dataKey?: string | number;
  value?: number;
  color?: string;
};

/** Tooltip for the net-worth line chart. Each scenario emits two series —
 *  total and "{name} vested" — but we collapse them to a single row showing
 *  whichever value is lower (always the vested figure under normal data,
 *  but min() keeps it correct if that ever flips). */
function LesserOfTooltip({
  active,
  payload,
  label,
  ccy,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  ccy: string;
}) {
  if (!active || !payload?.length) return null;
  const byScenario = new Map<string, { total?: number; vested?: number; color: string }>();
  for (const p of payload) {
    const key = String(p.dataKey ?? "");
    if (!key) continue;
    const isVested = key.endsWith(" vested");
    const sc = isVested ? key.slice(0, -" vested".length) : key;
    const cur = byScenario.get(sc) ?? { color: p.color ?? "#000" };
    if (isVested) cur.vested = p.value;
    else cur.total = p.value;
    byScenario.set(sc, cur);
  }
  const rows = [...byScenario.entries()].flatMap(([name, v]) => {
    const candidates = [v.total, v.vested].filter((x): x is number => typeof x === "number");
    if (candidates.length === 0) return [];
    return [{ name, value: Math.min(...candidates), color: v.color }];
  });
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border bg-background/95 px-2 py-1 text-xs shadow">
      <p className="font-medium mb-0.5">As of {label ? formatMmmYY(label) : ""}</p>
      {rows.map((r) => (
        <p key={r.name} className="tabular-nums">
          <span
            className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
            style={{ background: r.color }}
          />
          {r.name}: {formatMoney(r.value, ccy)}
        </p>
      ))}
    </div>
  );
}

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
  asOfMonth,
  setAsOfMonth,
  isToday,
  todayMonthISO,
}: {
  ccy: string;
  horizonYears: HorizonYears;
  scenarioName: string;
  realised: Slice[];
  coming: Slice[];
  asOfMonth: string;
  setAsOfMonth: (v: string) => void;
  isToday: boolean;
  todayMonthISO: string;
}) {
  // Asset-type filters. Both on by default — toggling lets the user see the
  // pie restricted to just stocks or just property.
  const [showStocks, setShowStocks] = useState(true);
  const [showProperty, setShowProperty] = useState(true);

  const passes = (s: Slice) =>
    (s.kind === "stock" && showStocks) || (s.kind === "property" && showProperty);

  const realisedFiltered = realised.filter(passes);
  const comingFiltered = coming.filter(passes);
  const realisedTotal = realisedFiltered.reduce((s, x) => s + x.value, 0);
  const comingTotal = comingFiltered.reduce((s, x) => s + x.value, 0);
  const grandTotal = realisedTotal + comingTotal;
  const empty = grandTotal === 0;

  // Sort each section by descending value for readable slice order
  const todaySorted = [...realisedFiltered].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const comingSorted = [...comingFiltered].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);

  const todayLabel = isToday ? "Today" : asOfMonth;

  // INNER ring: the headline split — only two slices.
  // Both pies' values must sum to grandTotal so arcs align between rings.
  const innerData = [
    { name: todayLabel, value: realisedTotal, fill: TODAY_COLORS[0] },
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
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">
              Wealth allocation — {todayLabel} vs +{horizonYears}y · {scenarioName} ({ccy})
            </CardTitle>
            <CardDescription className="text-[11px]">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: TODAY_COLORS[0] }} />
                <b>{todayLabel}</b> {realisedPct.toFixed(0)}%
              </span>{" "}
              ·{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: COMING_COLORS[0] }} />
                <b>Coming ({horizonYears}y)</b> {comingPct.toFixed(0)}%
              </span>
              {" "}— inner ring is the headline split; outer breaks each side down by asset.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">As-of</Label>
            <Input
              type="month"
              value={asOfMonth}
              onChange={(e) => setAsOfMonth(e.target.value)}
              className="h-8 w-[140px] text-xs"
            />
            {!isToday ? (
              <button
                type="button"
                onClick={() => setAsOfMonth(todayMonthISO)}
                className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
              >
                Reset to today
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Label className="text-[11px] text-muted-foreground mr-1">Include</Label>
          <button
            type="button"
            onClick={() => setShowStocks((v) => !v)}
            className={
              showStocks
                ? "rounded-full border border-primary bg-primary text-primary-foreground px-2.5 py-1 text-[11px] font-medium"
                : "rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
            }
          >
            Stocks
          </button>
          <button
            type="button"
            onClick={() => setShowProperty((v) => !v)}
            className={
              showProperty
                ? "rounded-full border border-primary bg-primary text-primary-foreground px-2.5 py-1 text-[11px] font-medium"
                : "rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
            }
          >
            Property
          </button>
        </div>
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
