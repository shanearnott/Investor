"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
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
import { parseISO, Property, releaseKeptShares, releaseWithholdingShares, Scenario, ScenarioSchema, sellSharesFor, StockHolding, type Settings, vestedSharesAt } from "@/lib/models";
import {
  applyScenarioTermination,
  buildNetWorthSeries,
  holdingSaleAccrual,
  projectPropertyValueAt,
  projectStockValueAt,
  resolveReleasePool,
  resolveScenarioSales,
  resolvedByHolding,
  startingPriceForScenario,
} from "@/lib/projections";
import { formatMoney, formatNumber } from "@/lib/utils";

const HORIZON_OPTIONS = [2, 5, 10, 15, 20] as const;
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
  const resolved = resolveScenarioSales(args.scenario, args.holdings, settingsForCcy);
  const byHolding = resolvedByHolding(resolved);
  let saleCash = 0;
  for (const h of args.holdings) {
    const v = projectStockValueAt(h, args.scenario, args.asOf, args.ccy, settingsForCcy);
    const acc = holdingSaleAccrual(byHolding.get(h.id) ?? [], v.shares_vested, args.asOf);
    const free = Math.max(0, v.shares_vested - acc.scenarioRemovedShares);
    const liquidFree = v.shares_vested > 0 ? v.liquid * (free / v.shares_vested) : 0;
    const liquidAdj = liquidFree + acc.lockedLiquid;
    if (liquidAdj > 0) {
      out.push({ name: h.ticker || h.company_name || h.id, value: Math.round(liquidAdj), kind: "stock" });
    }
    saleCash += acc.cash + acc.pending;
  }
  for (const p of args.properties) {
    const v = projectPropertyValueAt(p, args.scenario, args.asOf, args.ccy, settingsForCcy);
    if (v.equity > 0) {
      out.push({ name: `${p.name} (property)`, value: Math.round(v.equity), kind: "property" });
    }
  }
  if (saleCash > 0) {
    out.push({ name: SALE_CASH_LABEL, value: Math.round(saleCash), kind: "cash" });
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
  const resolved = resolveScenarioSales(args.scenario, args.holdings, settingsForCcy);
  const byHolding = resolvedByHolding(resolved);
  let cashNow = 0;
  let cashHor = 0;

  for (const h of args.holdings) {
    const sales = byHolding.get(h.id) ?? [];
    const now = projectStockValueAt(h, args.scenario, args.asOf, args.ccy, settingsForCcy);
    const accNow = holdingSaleAccrual(sales, now.shares_vested, args.asOf);
    const freeNow = Math.max(0, now.shares_vested - accNow.scenarioRemovedShares);
    const realisedNow =
      (now.shares_vested > 0 ? now.liquid * (freeNow / now.shares_vested) : 0) + accNow.lockedLiquid;
    const v = projectStockValueAt(h, args.scenario, horizon, args.ccy, settingsForCcy);
    const accHor = holdingSaleAccrual(sales, v.shares_vested, horizon);
    const freeHor = Math.max(0, v.shares_vested - accHor.scenarioRemovedShares);
    const horizonTotal =
      (v.shares_vested > 0 ? v.liquid * (freeHor / v.shares_vested) : 0) + accHor.lockedLiquid + v.unvested;
    const coming = Math.max(0, horizonTotal - realisedNow);
    if (coming > 0) out.push({ name: h.ticker || h.company_name || h.id, value: Math.round(coming), kind: "stock" });
    cashNow += accNow.cash + accNow.pending;
    cashHor += accHor.cash + accHor.pending;
  }
  for (const p of args.properties) {
    const realisedNow = projectPropertyValueAt(p, args.scenario, args.asOf, args.ccy, settingsForCcy).equity;
    const v = projectPropertyValueAt(p, args.scenario, horizon, args.ccy, settingsForCcy);
    const coming = Math.max(0, v.equity - realisedNow);
    if (coming > 0) out.push({ name: `${p.name} (property)`, value: Math.round(coming), kind: "property" });
  }
  // Cash from sales that land between asOf and horizon.
  const comingCash = Math.max(0, cashHor - cashNow);
  if (comingCash > 0) {
    out.push({ name: SALE_CASH_LABEL, value: Math.round(comingCash), kind: "cash" });
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
  // Asset-type filters for the line chart. Both on by default; toggling
  // restricts the line series to just stocks or just property so the user
  // can isolate one. Same UX as the wealth-allocation pie below.
  const [lineShowStocks, setLineShowStocks] = useState(true);
  const [lineShowProperty, setLineShowProperty] = useState(true);
  const [lineShowCash, setLineShowCash] = useState(true);
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

  // Chart start month (YYYY-MM). Defaults to the current month.
  const chartTodayMonth = new Date().toISOString().slice(0, 7);
  const [chartStartMonth, setChartStartMonth] = useState<string>(chartTodayMonth);
  const chartStartDate = useMemo(() => {
    const [y, m] = chartStartMonth.split("-").map(Number);
    return y && m ? new Date(Date.UTC(y, m - 1, 1)) : new Date();
  }, [chartStartMonth]);

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
        config: { horizon_years: horizonYears, step_months: 1, start: chartStartDate },
      });
    }
    return out;
  }, [chosen, data.stocks, data.properties, settings, displayCurrency, horizonYears, chartStartDate]);

  const ccy = displayCurrency;

  // KPIs from row 0 of any selected scenario
  const firstSeries = chosen[0] ? seriesByScenario[chosen[0].id] : [];
  const todayRow = firstSeries[0];
  const liquidToday = todayRow?.liquid_equity_total ?? 0;
  const unvestedToday = todayRow?.unvested_equity_total ?? 0;
  const propertyToday = todayRow?.property_equity_total ?? 0;

  // Vested-equity (pre-tax) snapshot today — vested shares × current price,
  // no RSU income-tax haircut. Used by the KPI tile.
  const todayDate = new Date();
  // The pre-tax tile follows the first selected scenario so it tracks
  // assumed-price overrides as the user toggles bear/base/bull. Falls
  // back to a stub scenario (no overrides → uses the holding's actual
  // price) when nothing is selected.
  const pretaxScenario: Scenario = chosen[0] ?? fallbackScenario();
  const stocksPretaxToday = data.stocks.reduce((sum, h) => {
    const startPrice = startingPriceForScenario(pretaxScenario, h);
    const vested = vestedSharesAt(h, todayDate);
    const perShare = h.equity_type === "Stock Options"
      ? Math.max(0, startPrice - (h.strike_price ?? 0))
      : startPrice;
    const native = vested * perShare;
    return sum + convert(native, h.currency, ccy, settings);
  }, 0);

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
          // total = vested + unvested + property + realised cash + pending
          // (released-not-sold, keeps the line continuous). Mask out whichever
          // asset class is filtered off; cash/pending always count.
          const stockTotal = (lineShowStocks ? 1 : 0) * (r.liquid_equity_total + r.unvested_equity_total);
          const stockVested = (lineShowStocks ? 1 : 0) * r.liquid_equity_total;
          const property = (lineShowProperty ? 1 : 0) * r.property_equity_total;
          const cash = (lineShowCash ? 1 : 0) * (r.cash_total + r.pending_sale_total);
          row[sc.name] = Math.round(stockTotal + property + cash);
          row[`${sc.name} vested`] = Math.round(stockVested + property + cash);
          // One bar series per scenario so they don't get lost when several
          // scenarios are selected; coloured to match the scenario line.
          if (lineShowCash && r.sale_proceeds_step > 0) {
            row[`${sc.name} sold`] = Math.round(r.sale_proceeds_step);
          }
        }
      }
      return row;
    });
  }, [chosen, seriesByScenario, lineShowStocks, lineShowProperty, lineShowCash]);

  // Pin x-axis ticks to every Jan/Jul present in the line data so the
  // user always gets a labelled six-month boundary. Memoised so Recharts
  // sees a stable array reference across animation frames.
  const janJulTicks = useMemo(() => {
    return lineData
      .map((r) => r.date as string)
      .filter((d) => typeof d === "string" && (d.endsWith("-01-01") || d.endsWith("-07-01")));
  }, [lineData]);

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

  // Pie as-of slider tracks the line chart's horizon, so the user can
  // scrub ±horizonYears around today. Shrinking the horizon should pull
  // the as-of back inside the new window if the user was at, say, +5y
  // and just dropped horizon to 2y.
  useEffect(() => {
    const [y, m] = asOfMonth.split("-").map(Number);
    if (!y || !m) return;
    const t = new Date();
    const offset = (y - t.getUTCFullYear()) * 12 + ((m - 1) - t.getUTCMonth());
    const max = horizonYears * 12;
    const clamped = Math.max(-max, Math.min(max, offset));
    if (clamped === offset) return;
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + clamped, 1));
    setAsOfMonth(d.toISOString().slice(0, 7));
  }, [horizonYears, asOfMonth]);

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
            <Label className="text-xs text-muted-foreground">Start</Label>
            <Input
              type="month"
              value={chartStartMonth}
              onChange={(e) => setChartStartMonth(e.target.value || chartTodayMonth)}
              className="h-8 w-[140px] text-xs"
            />
            {chartStartMonth !== chartTodayMonth ? (
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:underline"
                onClick={() => setChartStartMonth(chartTodayMonth)}
              >
                today
              </button>
            ) : null}
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
            <Kpi label="Vested equity (pre-tax)" valueNum={stocksPretaxToday} ccy={ccy} settings={settings} />
            <Kpi label="Property equity (pre-tax)" valueNum={propertyToday} ccy={ccy} settings={settings} />
            <Kpi label="Vested equity (post-tax)" valueNum={liquidToday} ccy={ccy} settings={settings} />
            <Kpi label="Unvested equity (post-tax)" valueNum={unvestedToday} ccy={ccy} settings={settings} />
          </div>

          <ScenarioSaleMath
            chosen={chosen}
            holdings={data.stocks}
            settings={{ ...settings, primary_currency: ccy as typeof settings.primary_currency }}
          />

          <Card>
            <CardHeader>
              <CardTitle>Net (post-tax) worth over time ({ccy})</CardTitle>
              <CardDescription>
                Solid line = shares + property + cash combined (vested + unvested + realised/pending cash). Dashed line = vested + property + cash only. Bars mark planned sales (post-tax proceeds), coloured to match each scenario&apos;s line. RSU income tax (per scenario) is already applied. {chosen.map((s) => s.name).join(" · ") || "—"}
              </CardDescription>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-muted-foreground mr-1">Show</span>
                <button
                  type="button"
                  onClick={() => setLineShowStocks((v) => !v)}
                  className={
                    lineShowStocks
                      ? "rounded-full border border-primary bg-primary text-primary-foreground px-2.5 py-1 text-[11px] font-medium"
                      : "rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                  }
                >
                  📊 Stocks
                </button>
                <button
                  type="button"
                  onClick={() => setLineShowProperty((v) => !v)}
                  className={
                    lineShowProperty
                      ? "rounded-full border border-primary bg-primary text-primary-foreground px-2.5 py-1 text-[11px] font-medium"
                      : "rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                  }
                >
                  🏠 Properties
                </button>
                <button
                  type="button"
                  onClick={() => setLineShowCash((v) => !v)}
                  className={
                    lineShowCash
                      ? "rounded-full border border-primary bg-primary text-primary-foreground px-2.5 py-1 text-[11px] font-medium"
                      : "rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                  }
                >
                  💵 Cash
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[320px] w-full">
                <ResponsiveContainer>
                  <ComposedChart data={lineData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      minTickGap={20}
                      {...(janJulTicks.length > 0 ? { ticks: janJulTicks } : {})}
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
                      // Order matters: draw the dashed vested line first, then
                      // the solid combined line on top. Where the two converge
                      // the solid line covers the dashed one, so a fully-vested
                      // tail reads as a single solid line. Animation on all
                      // marks so users can see where the line moved up vs down
                      // when scenarios toggle or inputs change.
                      return [
                        <Bar
                          key={`${s.id}-sold`}
                          dataKey={`${s.name} sold`}
                          fill={colour}
                          fillOpacity={0.55}
                          barSize={8}
                          isAnimationActive
                          animationDuration={700}
                          animationEasing="ease-out"
                          legendType="none"
                        />,
                        <Line
                          key={`${s.id}-vested`}
                          type="monotone"
                          dataKey={`${s.name} vested`}
                          stroke={colour}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          dot={false}
                          isAnimationActive
                          animationDuration={700}
                          animationEasing="ease-out"
                          legendType="none"
                        />,
                        <Line
                          key={`${s.id}-total`}
                          type="monotone"
                          dataKey={s.name}
                          stroke={colour}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive
                          animationDuration={700}
                          animationEasing="ease-out"
                        />,
                      ];
                    })}
                  </ComposedChart>
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

type Slice = { name: string; value: number; kind: "stock" | "property" | "cash" };

const SALE_CASH_LABEL = "Cash from sales";

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
  const byScenario = new Map<string, { total?: number; vested?: number; sold?: number; color: string }>();
  for (const p of payload) {
    const key = String(p.dataKey ?? "");
    if (!key) continue;
    let sc = key;
    let field: "total" | "vested" | "sold" = "total";
    if (key.endsWith(" sold")) {
      sc = key.slice(0, -" sold".length);
      field = "sold";
    } else if (key.endsWith(" vested")) {
      sc = key.slice(0, -" vested".length);
      field = "vested";
    }
    const cur = byScenario.get(sc) ?? { color: p.color ?? "#000" };
    if (field === "sold") {
      if (typeof p.value === "number" && p.value > 0) cur.sold = p.value;
    } else if (field === "vested") {
      cur.vested = p.value;
    } else {
      cur.total = p.value;
    }
    byScenario.set(sc, cur);
  }
  const rows = [...byScenario.entries()].flatMap(([name, v]) => {
    const candidates = [v.total, v.vested].filter((x): x is number => typeof x === "number");
    if (candidates.length === 0 && v.sold === undefined) return [];
    return [{ name, value: candidates.length ? Math.min(...candidates) : undefined, sold: v.sold, color: v.color }];
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
          {r.name}: {r.value !== undefined ? formatMoney(r.value, ccy) : "—"}
          {r.sold !== undefined ? ` · sold ${formatMoney(r.sold, ccy)}` : ""}
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
  const [showCash, setShowCash] = useState(true);

  const passes = (s: Slice) =>
    (s.kind === "cash" && showCash) ||
    (s.kind === "stock" && showStocks) ||
    (s.kind === "property" && showProperty);

  const realisedFiltered = realised.filter(passes);
  const comingFiltered = coming.filter(passes);
  const realisedTotal = realisedFiltered.reduce((s, x) => s + x.value, 0);
  const comingTotal = comingFiltered.reduce((s, x) => s + x.value, 0);
  const grandTotal = realisedTotal + comingTotal;
  const empty = grandTotal === 0;

  // Sort each section by descending value for readable slice order
  const todaySorted = [...realisedFiltered].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const comingSorted = [...comingFiltered].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);

  const todayLabel = isToday ? "Today" : formatMmmYY(`${asOfMonth}-01`);
  // Horizon = asOfDate + horizonYears, rendered in the same MMM-YY format
  // as the rest of the pie. No mixed "+5y" vs "May-30" labels.
  const horizonLabel = (() => {
    const [y, m] = asOfMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + horizonYears * 12, 1));
    return formatMmmYY(d.toISOString().slice(0, 10));
  })();

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
  const SALE_CASH_FILL = "#f59e0b"; // amber, matches the sale bars
  const outerData: OuterSlice[] = [
    ...todaySorted.map((s, i) => ({
      name: s.name,
      value: s.value,
      fill: s.name === SALE_CASH_LABEL ? SALE_CASH_FILL : TODAY_COLORS[(i + 1) % TODAY_COLORS.length],
      bucket: "today" as const,
    })),
    ...comingSorted.map((s, i) => ({
      name: s.name,
      value: s.value,
      fill: s.name === SALE_CASH_LABEL ? SALE_CASH_FILL : COMING_COLORS[(i + 1) % COMING_COLORS.length],
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
              Wealth allocation — {todayLabel} vs {horizonLabel} · {scenarioName} ({ccy})
            </CardTitle>
            <CardDescription className="text-[11px]">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: TODAY_COLORS[0] }} />
                <b>{todayLabel}</b> {realisedPct.toFixed(0)}%
              </span>{" "}
              ·{" "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: COMING_COLORS[0] }} />
                <b>Coming ({horizonLabel})</b> {comingPct.toFixed(0)}%
              </span>
              {" "}— inner ring is the headline split; outer breaks each side down by asset.
            </CardDescription>
          </div>
          <div className="flex w-full flex-col items-stretch gap-1 sm:w-auto sm:min-w-[18rem]">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px] text-muted-foreground">As-of</Label>
              <span className="text-xs tabular-nums font-medium">{formatMmmYY(`${asOfMonth}-01`)}</span>
              {!isToday ? (
                <button
                  type="button"
                  onClick={() => setAsOfMonth(todayMonthISO)}
                  className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent"
                >
                  Today
                </button>
              ) : null}
            </div>
            <input
              type="range"
              min={-horizonYears * 12}
              max={horizonYears * 12}
              step={1}
              value={(() => {
                const [y, m] = asOfMonth.split("-").map(Number);
                const t = new Date();
                return (y - t.getUTCFullYear()) * 12 + ((m - 1) - t.getUTCMonth());
              })()}
              onChange={(e) => {
                const offset = Number(e.target.value);
                const t = new Date();
                const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1));
                setAsOfMonth(d.toISOString().slice(0, 7));
              }}
              className="h-6 w-full accent-foreground"
              aria-label="As-of date"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>−{horizonYears}y</span>
              <span>Today</span>
              <span>+{horizonYears}y</span>
            </div>
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
            📊 Stocks
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
            🏠 Properties
          </button>
          <button
            type="button"
            onClick={() => setShowCash((v) => !v)}
            className={
              showCash
                ? "rounded-full border border-primary bg-primary text-primary-foreground px-2.5 py-1 text-[11px] font-medium"
                : "rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
            }
          >
            💵 Cash
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

/** Expandable per-scenario per-sale math panel — mirrors the
 *  funding/cost breakdown on the projects page so the user can see
 *  exactly how each planned sale's net cash was derived. */
function ScenarioSaleMath({
  chosen,
  holdings,
  settings,
}: {
  chosen: Scenario[];
  holdings: StockHolding[];
  settings: ReturnType<typeof useData>["data"]["settings"];
}) {
  const ccy = settings.primary_currency;
  const perScenario = useMemo(() => {
    return chosen.map((sc) => {
      const sales = resolveScenarioSales(sc, holdings, settings as Settings);
      // Project every holding to the scenario horizon and net off the
      // scenario's sales so the user can see what's left in their pile
      // at the end of the modelled period.
      const now = new Date();
      const horizon = new Date(
        Date.UTC(now.getUTCFullYear() + sc.horizon_years, now.getUTCMonth(), 1),
      );
      const soldSharesByStock = new Map<string, number>();
      for (const sale of sales) {
        soldSharesByStock.set(
          sale.stockId,
          (soldSharesByStock.get(sale.stockId) ?? 0) + sale.shares,
        );
      }
      // Per-holding breakdown so the user can see *why* a 100% sell
      // leaves shares behind (other releases, untouched tranche vests,
      // future tranche vests within the horizon, scenario withholding,
      // etc.). Each component is in tranche-counted shares so the user
      // can reconcile against vestedSharesAt().
      type TrancheAlloc = {
        trancheId: string;
        trancheName: string;
        fromDate: string;
        toDate: string;
        shares: number;
      };
      type TrancheRow = {
        id: string;
        name: string;
        fromDate: string;
        toDate: string;
        granted: number;
        vestedByHorizon: number;
        /** Shares from this tranche that no release event covers — i.e.
         *  vested but never routed through a release. Flagged amber on
         *  the UI so the user can see exactly where the leftover lives. */
        unreleased: number;
        /** Kept shares allocated to this tranche from each release that
         *  haven't been sold by horizon. */
        keptUnsold: Array<{ releaseName: string; shares: number }>;
      };
      type ReleaseRow = {
        id: string;
        name: string;
        date: string;
        gross: number;
        kept: number;
        withheld: number;
        soldIRL: number;
        unsold: number;
        fromTranches: TrancheAlloc[];
      };
      type ScenarioReleaseRow = {
        id: string;
        name: string;
        date: string;
        gross: number;
        withheld: number;
        kept: number;
        unsold: number;
        fromTranches: TrancheAlloc[];
      };
      type ScenarioSellRow = {
        id: string;
        name: string;
        date: string;
        releaseRef: string;
        releaseName: string;
        shares: number;
        fromTranches: TrancheAlloc[];
      };
      type Breakdown = {
        tranches: TrancheRow[];
        investReleases: ReleaseRow[];
        scenarioReleases: ScenarioReleaseRow[];
        scenarioSells: ScenarioSellRow[];
        grantedTotal: number;
        vestedByHorizon: number;
        unvestedAtHorizon: number;
        investWithholding: number;
        investSells: number;
        scenarioWithholding: number;
        scenarioSellsTotal: number;
        /** Scenario stock_overrides[h.id]?.termination_date in ISO. */
        terminationDate: string | null;
        /** Vest events forfeited because their vest_date > termination_date. */
        forfeitedShares: number;
      };
      // Build the engine's release pool once per scenario so the
       // debug breakdown reports identical numbers (gross / kept /
       // withholding) to the actual simulation — re-deriving from
       // vestedSharesAt double-deducts and confuses users.
      const releasePool = resolveReleasePool(sc, holdings, settings as Settings);
      const remaining = holdings
        .map((h) => {
          const v = projectStockValueAt(h, sc, horizon, ccy, settings as Settings);
          const sold = soldSharesByStock.get(h.id) ?? 0;
          const freeVested = Math.max(0, v.shares_vested - sold);
          const liquidFree =
            v.shares_vested > 0 ? v.liquid * (freeVested / v.shares_vested) : 0;
          const shares = freeVested + v.shares_unvested;
          const value = liquidFree + v.unvested;

          // Tranche-level: use the termination-adjusted holding so a
          // forfeited (post-termination) vest doesn't count toward
          // "granted" or "vested" here — that's the whole point of
          // termination. The forfeited count is summed separately so
          // the reconciliation explains why the remaining row dropped.
          const adjusted = applyScenarioTermination(h, sc);
          const terminationDate = sc.stock_overrides?.[h.id]?.termination_date ?? null;
          const trancheNameById = new Map<string, string>();
          for (const t of adjusted.tranches) {
            trancheNameById.set(t.id, t.name || `Tranche ${t.id.slice(0, 6)}`);
          }

          // --- FIFO allocator ---
          // Each vest event becomes a "slice" of `remaining` gross
          // shares. Releases (investment + scenario, chronological)
          // consume slices in vest order. Each release records which
          // tranche slice it pulled how many shares from, so we can
          // surface "Release came from Tranche X (vests 2024-01 to
          // 2024-06), 500 sh". The kept portion of each release is
          // tracked per-slice too, so sales can FIFO-draw from the
          // kept pool and we can attribute "kept-unsold" back to a
          // specific tranche at horizon.
          type Slice = {
            trancheId: string;
            vestDate: string;
            total: number;
            remaining: number;
            /** Map releaseId → kept shares still in that release's
             *  kept pool from this slice. */
            keptByRelease: Map<string, number>;
            soldByRelease: Map<string, number>;
          };
          const slices: Slice[] = [];
          for (const t of adjusted.tranches) {
            for (const ev of t.vest_events) {
              const d = parseISO(ev.vest_date);
              if (!d || d > horizon) continue;
              slices.push({
                trancheId: t.id,
                vestDate: ev.vest_date,
                total: ev.shares,
                remaining: ev.shares,
                keptByRelease: new Map(),
                soldByRelease: new Map(),
              });
            }
          }
          slices.sort((a, b) => a.vestDate.localeCompare(b.vestDate));

          // Aggregate per-tranche slice contributions into a single
          // {trancheId, fromDate, toDate, shares} row for display.
          function aggregateByTranche(
            entries: Array<{ trancheId: string; vestDate: string; shares: number }>,
          ): TrancheAlloc[] {
            const m = new Map<string, { from: string; to: string; shares: number }>();
            for (const e of entries) {
              if (e.shares <= 0) continue;
              const cur = m.get(e.trancheId);
              if (!cur) {
                m.set(e.trancheId, { from: e.vestDate, to: e.vestDate, shares: e.shares });
              } else {
                cur.shares += e.shares;
                if (e.vestDate < cur.from) cur.from = e.vestDate;
                if (e.vestDate > cur.to) cur.to = e.vestDate;
              }
            }
            const out: TrancheAlloc[] = [];
            for (const [trancheId, v] of m) {
              out.push({
                trancheId,
                trancheName: trancheNameById.get(trancheId) ?? trancheId.slice(0, 6),
                fromDate: v.from,
                toDate: v.to,
                shares: v.shares,
              });
            }
            return out.sort((a, b) => a.fromDate.localeCompare(b.fromDate));
          }

          // Build the chronological release schedule (investment first
          // by date, then scenario). Scenario releases pull `grossShares`
          // straight from the engine's pool so the math matches.
          type ReleaseDef = {
            id: string;
            name: string;
            date: string;
            kind: "investment" | "scenario";
            gross: number;
            kept: number;
            withheld: number;
          };
          const releaseDefs: ReleaseDef[] = [];
          for (const r of h.releases ?? []) {
            const d = parseISO(r.release_date);
            if (!d || d > horizon) continue;
            releaseDefs.push({
              id: r.id,
              name: r.name || `Release ${r.release_date}`,
              date: r.release_date,
              kind: "investment",
              gross: r.shares,
              kept: releaseKeptShares(r),
              withheld: releaseWithholdingShares(r),
            });
          }
          for (const sr of sc.releases ?? []) {
            if (sr.stock_id !== h.id) continue;
            const d = parseISO(sr.release_date);
            if (!d || d > horizon) continue;
            const resolved = releasePool.get(sr.id);
            if (!resolved) continue;
            const gross = resolved.grossShares;
            const kept = resolved.keptShares;
            releaseDefs.push({
              id: sr.id,
              name: sr.name || `Scenario release ${sr.release_date}`,
              date: sr.release_date,
              kind: "scenario",
              gross,
              kept,
              withheld: Math.max(0, gross - kept),
            });
          }
          releaseDefs.sort((a, b) => a.date.localeCompare(b.date));

          // FIFO allocate gross across slices for each release.
          const releaseAllocs = new Map<string, TrancheAlloc[]>();
          for (const rel of releaseDefs) {
            let need = rel.gross;
            const raw: Array<{ trancheId: string; vestDate: string; shares: number }> = [];
            const keepRatio = rel.gross > 0 ? rel.kept / rel.gross : 0;
            for (const s of slices) {
              if (need <= 0.0001) break;
              if (s.remaining <= 0.0001) continue;
              const take = Math.min(s.remaining, need);
              s.remaining -= take;
              need -= take;
              raw.push({ trancheId: s.trancheId, vestDate: s.vestDate, shares: take });
              // Per-slice kept allocation (proportional to keepRatio).
              const keptHere = take * keepRatio;
              if (keptHere > 0) {
                s.keptByRelease.set(rel.id, (s.keptByRelease.get(rel.id) ?? 0) + keptHere);
              }
            }
            releaseAllocs.set(rel.id, aggregateByTranche(raw));
          }

          // Tally investment sells per release id so the engine's
          // pool math matches what's actually held.
          const releasesByIdRaw = new Map((h.releases ?? []).map((r) => [r.id, r]));
          const investSellsByRelease = new Map<string, number>();
          for (const s of h.sells ?? []) {
            const d = parseISO(s.sell_date);
            if (!d || d > horizon) continue;
            const release = releasesByIdRaw.get(s.release_id) ?? null;
            const n = sellSharesFor(s, release);
            investSellsByRelease.set(s.release_id, (investSellsByRelease.get(s.release_id) ?? 0) + n);
          }
          // Apply investment sells to slices' kept pool (FIFO within
          // each release's slices).
          for (const [releaseId, sold] of investSellsByRelease) {
            let need = sold;
            for (const s of slices) {
              if (need <= 0.0001) break;
              const keptHere = s.keptByRelease.get(releaseId) ?? 0;
              if (keptHere <= 0.0001) continue;
              const take = Math.min(keptHere, need);
              s.keptByRelease.set(releaseId, keptHere - take);
              s.soldByRelease.set(releaseId, (s.soldByRelease.get(releaseId) ?? 0) + take);
              need -= take;
            }
          }

          // Scenario sells — iterate the scenario.sells in the same
          // chronological order the engine uses, matching each to a
          // ResolvedSale by index over this stock's sales (the engine
          // emits one per non-empty sell).
          const stockSales = sales.filter((s) => s.stockId === h.id);
          const stockSellsRaw = (sc.sells ?? [])
            .filter((s) => !!s.release_ref)
            .filter((s) => {
              // Stock match: see if release_ref maps to this holding.
              const inv = (h.releases ?? []).find((rr) => rr.id === s.release_ref);
              if (inv) return true;
              const scn = (sc.releases ?? []).find((rr) => rr.id === s.release_ref);
              return scn?.stock_id === h.id;
            })
            .sort((a, b) => a.sell_date.localeCompare(b.sell_date));
          const scenarioSells: ScenarioSellRow[] = [];
          for (let i = 0; i < stockSellsRaw.length; i++) {
            const sell = stockSellsRaw[i];
            const sd = parseISO(sell.sell_date);
            if (!sd || sd > horizon) continue;
            // Match to the resolved sale by release_ref + sell_date.
            const matched = stockSales.find(
              (s) => s.breakdown?.releaseRef === sell.release_ref
                && s.breakdown?.sellDate === sell.sell_date,
            );
            const shares = matched?.shares ?? 0;
            // FIFO consume from the release's kept slice pool.
            let need = shares;
            const rawTaken: Array<{ trancheId: string; vestDate: string; shares: number }> = [];
            for (const s of slices) {
              if (need <= 0.0001) break;
              const keptHere = s.keptByRelease.get(sell.release_ref!) ?? 0;
              if (keptHere <= 0.0001) continue;
              const take = Math.min(keptHere, need);
              s.keptByRelease.set(sell.release_ref!, keptHere - take);
              s.soldByRelease.set(sell.release_ref!, (s.soldByRelease.get(sell.release_ref!) ?? 0) + take);
              need -= take;
              rawTaken.push({ trancheId: s.trancheId, vestDate: s.vestDate, shares: take });
            }
            scenarioSells.push({
              id: `${h.id}:${i}`,
              name: sell.name || matched?.breakdown?.sellName || `Sell ${i + 1}`,
              date: sell.sell_date,
              releaseRef: sell.release_ref!,
              releaseName: matched?.breakdown?.releaseName ?? sell.release_ref!,
              shares,
              fromTranches: aggregateByTranche(rawTaken),
            });
          }
          const scenarioSellsTotal = scenarioSells.reduce((n, s) => n + s.shares, 0);

          // Build display rows.
          const investReleases: ReleaseRow[] = [];
          const scenarioReleases: ScenarioReleaseRow[] = [];
          for (const rel of releaseDefs) {
            const fromTranches = releaseAllocs.get(rel.id) ?? [];
            // Sum remaining kept (per slice) for this release.
            let unsold = 0;
            for (const s of slices) unsold += s.keptByRelease.get(rel.id) ?? 0;
            if (rel.kind === "investment") {
              const soldIRL = investSellsByRelease.get(rel.id) ?? 0;
              investReleases.push({
                id: rel.id,
                name: rel.name,
                date: rel.date,
                gross: rel.gross,
                kept: rel.kept,
                withheld: rel.withheld,
                soldIRL,
                unsold,
                fromTranches,
              });
            } else {
              scenarioReleases.push({
                id: rel.id,
                name: rel.name,
                date: rel.date,
                gross: rel.gross,
                withheld: rel.withheld,
                kept: rel.kept,
                unsold,
                fromTranches,
              });
            }
          }
          const investWithholding = investReleases.reduce((n, r) => n + r.withheld, 0);
          const investSells = investReleases.reduce((n, r) => n + r.soldIRL, 0);
          const scenarioWithholding = scenarioReleases.reduce((n, r) => n + r.withheld, 0);

          // Per-tranche granted + vested + remaining (from the slice
          // state — `remaining` = unreleased, sum of keptByRelease =
          // kept-unsold-by-release).
          const tranches: TrancheRow[] = adjusted.tranches.map((t) => {
            const granted = t.vest_events.reduce((n, ev) => n + ev.shares, 0);
            const vestedByHorizon = t.vest_events.reduce((n, ev) => {
              const d = parseISO(ev.vest_date);
              return d && d <= horizon ? n + ev.shares : n;
            }, 0);
            const trancheSlices = slices.filter((s) => s.trancheId === t.id);
            const fromDate = trancheSlices.length > 0 ? trancheSlices[0].vestDate : "";
            const toDate = trancheSlices.length > 0 ? trancheSlices[trancheSlices.length - 1].vestDate : "";
            const unreleased = trancheSlices.reduce((n, s) => n + s.remaining, 0);
            const keptUnsoldMap = new Map<string, number>();
            for (const s of trancheSlices) {
              for (const [releaseId, shares] of s.keptByRelease) {
                if (shares <= 0.0001) continue;
                const rel = releaseDefs.find((r) => r.id === releaseId);
                const name = rel?.name ?? "—";
                keptUnsoldMap.set(name, (keptUnsoldMap.get(name) ?? 0) + shares);
              }
            }
            const keptUnsold = Array.from(keptUnsoldMap.entries())
              .map(([releaseName, shares]) => ({ releaseName, shares }))
              .sort((a, b) => b.shares - a.shares);
            return {
              id: t.id,
              name: t.name || `Tranche ${t.id.slice(0, 6)}`,
              fromDate,
              toDate,
              granted,
              vestedByHorizon,
              unreleased,
              keptUnsold,
            };
          });
          const grantedTotal = tranches.reduce((n, t) => n + t.granted, 0);
          const vestedByHorizon = tranches.reduce((n, t) => n + t.vestedByHorizon, 0);
          const unvestedAtHorizon = Math.max(0, grantedTotal - vestedByHorizon);
          const rawGranted = h.tranches.reduce(
            (n, t) => n + t.vest_events.reduce((m, ev) => m + ev.shares, 0),
            0,
          );
          const forfeitedShares = Math.max(0, rawGranted - grantedTotal);

          const breakdown: Breakdown = {
            tranches,
            investReleases,
            scenarioReleases,
            scenarioSells,
            grantedTotal,
            vestedByHorizon,
            unvestedAtHorizon,
            investWithholding,
            investSells,
            scenarioWithholding,
            scenarioSellsTotal,
            terminationDate,
            forfeitedShares,
          };
          return { holding: h, shares, value, projectedPrice: v.projected_price, breakdown };
        })
        .filter((x) => x.shares > 0.5 || x.value > 0.5);
      const remainingTotal = remaining.reduce((n, x) => n + x.value, 0);
      return { scenario: sc, sales, horizon, remaining, remainingTotal };
    });
  }, [chosen, holdings, settings, ccy]);
  const totalSales = perScenario.reduce((n, p) => n + p.sales.length, 0);
  const totalRemaining = perScenario.reduce((n, p) => n + p.remaining.length, 0);
  if (totalSales === 0 && totalRemaining === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sale math</CardTitle>
        <CardDescription>
          Per-scenario walk-through of every planned sale — share counts,
          prices, cap-gains, net proceeds. Click a scenario to expand.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {perScenario.map(({ scenario, sales, horizon, remaining, remainingTotal }) => {
          if (sales.length === 0 && remaining.length === 0) return null;
          return (
            <details key={scenario.id} className="rounded-md border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                {scenario.name || "Untitled"}{" "}
                <span className="ml-2 text-xs text-muted-foreground">
                  {sales.length} sale{sales.length === 1 ? "" : "s"}
                  {remaining.length > 0 ? (
                    <>
                      {" "}· remaining {formatMoney(remainingTotal, ccy)}
                    </>
                  ) : null}
                </span>
              </summary>
              <div className="space-y-3 border-t p-3">
                {sales.map((r, i) => {
                  const b = r.breakdown;
                  if (!b) return null;
                  return (
                    <div key={i} className="rounded-md bg-muted/40 px-3 py-2 text-[11px] tabular-nums space-y-0.5">
                      <div className="flex justify-between font-semibold text-foreground">
                        <span>
                          {b.sellName || b.releaseName || `Sell ${i + 1}`}
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {b.releaseSource} release
                          </span>
                        </span>
                        <span>{b.releaseDate} → {b.sellDate}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Release: gross / kept</span>
                        <span>{formatNumber(Math.round(b.grossSharesAtRelease))} / {formatNumber(Math.round(b.keptSharesAtRelease))} sh</span>
                      </div>
                      {b.incomeTaxAtReleaseNative > 0 ? (
                        <div className="flex justify-between text-muted-foreground">
                          <span>
                            Income tax at release (info)
                            <span className="ml-1 text-[10px]">— pre-paid via cover, not deducted from sale</span>
                          </span>
                          <span>{formatMoney(b.incomeTaxAtReleaseNative, b.currency)}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between font-medium text-foreground">
                        <span>Release price (cost basis)</span>
                        <span>{formatMoney(b.releasePriceNative, b.currency, { fractionDigits: 2 })} / sh</span>
                      </div>
                      <div className="flex justify-between font-medium text-foreground">
                        <span>
                          Sale price{" "}
                          {b.salePriceFromProjection ? (
                            <span className="text-[10px] font-normal text-muted-foreground">(projected)</span>
                          ) : null}
                        </span>
                        <span>{formatMoney(b.salePriceNative, b.currency, { fractionDigits: 2 })} / sh</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Shares sold × sale price</span>
                        <span>{formatNumber(Math.round(b.sharesSold))} × {formatMoney(b.salePriceNative, b.currency, { fractionDigits: 2 })} = {formatMoney(b.grossSaleNative, b.currency)}</span>
                      </div>
                      <div className="flex justify-between font-medium text-foreground">
                        <span>Tax paid</span>
                        <span>−{formatMoney(b.capGainsTaxNative, b.currency)} <span className="text-[10px] font-normal text-muted-foreground">(cap-gains {b.capGainsRatePct.toFixed(1)}%)</span></span>
                      </div>
                      {b.strikePaidNative && b.strikePaidNative > 0 ? (
                        <div className="flex justify-between">
                          <span>Strike paid at exercise</span>
                          <span>−{formatMoney(b.strikePaidNative, b.currency)}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between font-semibold text-foreground border-t pt-1 mt-1">
                        <span>Resultant cash</span>
                        <span>{formatMoney(b.netNative, b.currency)}</span>
                      </div>
                      {b.currency !== ccy ? (
                        <div className="flex justify-between text-muted-foreground">
                          <span>In {ccy}</span>
                          <span>{formatMoney(b.netPrimary, ccy)}</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {remaining.length > 0 ? (
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] tabular-nums space-y-0.5">
                    <div className="flex justify-between font-semibold text-foreground">
                      <span>Remaining unsold at horizon</span>
                      <span>{horizon.toISOString().slice(0, 10)}</span>
                    </div>
                    {remaining.map(({ holding, shares, value, projectedPrice, breakdown }) => {
                      // Per-tranche remaining = unreleased + sum of
                      // kept-unsold across releases. Surface this as a
                      // visible-without-expanding list under the holding
                      // header so "which tranches have shares left?" is
                      // the headline answer, not buried in the expander.
                      const trancheRemaining = breakdown.tranches
                        .map((t) => {
                          const keptUnsold = t.keptUnsold.reduce((n, k) => n + k.shares, 0);
                          const stillVesting = Math.max(0, t.granted - t.vestedByHorizon);
                          const total = t.unreleased + keptUnsold + stillVesting;
                          return {
                            id: t.id,
                            name: t.name,
                            fromDate: t.fromDate,
                            toDate: t.toDate,
                            unreleased: t.unreleased,
                            keptUnsold,
                            stillVesting,
                            total,
                          };
                        })
                        .filter((t) => t.total > 0.5)
                        .sort((a, b) => b.total - a.total);
                      return (
                      <details key={holding.id} className="rounded-md border bg-background px-2 py-1">
                        <summary className="cursor-pointer">
                          <div className="flex justify-between">
                            <span>
                              {holding.ticker || holding.company_name || holding.id}
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                {formatNumber(Math.round(shares))} sh @ {formatMoney(projectedPrice, holding.currency, { fractionDigits: 2 })}
                              </span>
                            </span>
                            <span>{formatMoney(value, ccy)}</span>
                          </div>
                          {trancheRemaining.length > 0 ? (
                            <div className="mt-1 ml-2 space-y-0.5 text-[10px]">
                              {trancheRemaining.map((t) => (
                                <div key={t.id} className="flex justify-between">
                                  <span className="text-foreground">
                                    {t.name}
                                    {t.fromDate ? (
                                      <span className="ml-1 text-muted-foreground">
                                        ({t.fromDate} → {t.toDate})
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="tabular-nums text-foreground">
                                    {formatNumber(Math.round(t.total))} sh
                                    <span className="ml-1 text-muted-foreground">
                                      {[
                                        t.unreleased > 0.5 ? `${formatNumber(Math.round(t.unreleased))} unreleased` : null,
                                        t.keptUnsold > 0.5 ? `${formatNumber(Math.round(t.keptUnsold))} kept-unsold` : null,
                                        t.stillVesting > 0.5 ? `${formatNumber(Math.round(t.stillVesting))} still vesting` : null,
                                      ].filter(Boolean).join(" · ")}
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </summary>
                        <div className="mt-1 space-y-1 border-t pt-1 text-[10px] text-muted-foreground">
                          <div className="font-semibold text-foreground">By tranche</div>
                          {breakdown.tranches.length === 0 ? (
                            <div>No tranches recorded.</div>
                          ) : (
                            breakdown.tranches.map((t) => (
                              <div key={t.id} className="space-y-0.5">
                                <div className="flex justify-between">
                                  <span>
                                    {t.name}
                                    {t.fromDate ? (
                                      <span className="ml-1 text-[10px] text-muted-foreground">
                                        ({t.fromDate} → {t.toDate})
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="tabular-nums">
                                    {formatNumber(Math.round(t.vestedByHorizon))} / {formatNumber(t.granted)} sh vested
                                    {t.granted > t.vestedByHorizon ? ` · ${formatNumber(t.granted - t.vestedByHorizon)} still vesting` : ""}
                                  </span>
                                </div>
                                {t.unreleased > 0.5 ? (
                                  <div className="ml-3 flex justify-between text-amber-800">
                                    <span>· unreleased</span>
                                    <span className="tabular-nums">{formatNumber(Math.round(t.unreleased))} sh</span>
                                  </div>
                                ) : null}
                                {t.keptUnsold.map((k) => (
                                  <div key={k.releaseName} className="ml-3 flex justify-between text-amber-800">
                                    <span>· kept-unsold from {k.releaseName}</span>
                                    <span className="tabular-nums">{formatNumber(Math.round(k.shares))} sh</span>
                                  </div>
                                ))}
                              </div>
                            ))
                          )}
                          {breakdown.investReleases.length > 0 ? (
                            <>
                              <div className="font-semibold text-foreground pt-1">Investment releases</div>
                              {breakdown.investReleases.map((r) => (
                                <div key={r.id} className="space-y-0.5">
                                  <div className="flex justify-between">
                                    <span>{r.name} · {r.date}</span>
                                    <span className="tabular-nums">
                                      {formatNumber(r.gross)} gross · {formatNumber(Math.round(r.withheld))} withheld · {formatNumber(Math.round(r.kept))} kept
                                      {r.soldIRL > 0 ? ` · ${formatNumber(Math.round(r.soldIRL))} sold IRL` : ""}
                                      {r.unsold > 0.5 ? (
                                        <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900">
                                          {formatNumber(Math.round(r.unsold))} unsold
                                        </span>
                                      ) : null}
                                    </span>
                                  </div>
                                  {r.fromTranches.map((a) => (
                                    <div key={a.trancheId} className="ml-3 flex justify-between text-muted-foreground">
                                      <span>· from {a.trancheName} ({a.fromDate} → {a.toDate})</span>
                                      <span className="tabular-nums">{formatNumber(Math.round(a.shares))} sh</span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </>
                          ) : null}
                          {breakdown.scenarioReleases.length > 0 ? (
                            <>
                              <div className="font-semibold text-foreground pt-1">Scenario releases by horizon</div>
                              {breakdown.scenarioReleases.map((r) => (
                                <div key={r.id} className="space-y-0.5">
                                  <div className="flex justify-between">
                                    <span>{r.name} · {r.date}</span>
                                    <span className="tabular-nums">
                                      {formatNumber(Math.round(r.gross))} gross
                                      {r.withheld > 0 ? ` · ${formatNumber(Math.round(r.withheld))} withheld` : ""}
                                      {r.kept > 0 ? ` · ${formatNumber(Math.round(r.kept))} kept` : ""}
                                      {r.unsold > 0.5 ? (
                                        <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900">
                                          {formatNumber(Math.round(r.unsold))} unsold
                                        </span>
                                      ) : null}
                                    </span>
                                  </div>
                                  {r.fromTranches.map((a) => (
                                    <div key={a.trancheId} className="ml-3 flex justify-between text-muted-foreground">
                                      <span>· from {a.trancheName} ({a.fromDate} → {a.toDate})</span>
                                      <span className="tabular-nums">{formatNumber(Math.round(a.shares))} sh</span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </>
                          ) : null}
                          {breakdown.scenarioSells.length > 0 ? (
                            <>
                              <div className="font-semibold text-foreground pt-1">Scenario sells by horizon</div>
                              {breakdown.scenarioSells.map((s) => (
                                <div key={s.id} className="space-y-0.5">
                                  <div className="flex justify-between">
                                    <span>{s.name} · {s.date} → {s.releaseName}</span>
                                    <span className="tabular-nums">−{formatNumber(Math.round(s.shares))} sh</span>
                                  </div>
                                  {s.fromTranches.map((a) => (
                                    <div key={a.trancheId} className="ml-3 flex justify-between text-muted-foreground">
                                      <span>· from {a.trancheName} ({a.fromDate} → {a.toDate})</span>
                                      <span className="tabular-nums">−{formatNumber(Math.round(a.shares))} sh</span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </>
                          ) : null}
                          <div className="border-t pt-1 mt-1 font-semibold text-foreground">
                            <div className="flex justify-between">
                              <span>Granted total{breakdown.terminationDate ? " (post-termination)" : ""}</span>
                              <span className="tabular-nums">{formatNumber(breakdown.grantedTotal)} sh</span>
                            </div>
                            {breakdown.forfeitedShares > 0 ? (
                              <div className="flex justify-between text-amber-700 font-normal">
                                <span>
                                  Forfeited (vests past termination {breakdown.terminationDate ?? ""})
                                </span>
                                <span className="tabular-nums">−{formatNumber(Math.round(breakdown.forfeitedShares))} sh from grant</span>
                              </div>
                            ) : null}
                            <div className="flex justify-between text-muted-foreground font-normal">
                              <span>Vested by horizon</span>
                              <span className="tabular-nums">{formatNumber(Math.round(breakdown.vestedByHorizon))} sh</span>
                            </div>
                            <div className="flex justify-between text-muted-foreground font-normal">
                              <span>Unvested at horizon (still vesting later)</span>
                              <span className="tabular-nums">{formatNumber(Math.round(breakdown.unvestedAtHorizon))} sh</span>
                            </div>
                            <div className="flex justify-between text-muted-foreground font-normal">
                              <span>− Investment withholding + sells</span>
                              <span className="tabular-nums">−{formatNumber(Math.round(breakdown.investWithholding + breakdown.investSells))} sh</span>
                            </div>
                            {breakdown.scenarioWithholding > 0 ? (
                              <div className="flex justify-between text-muted-foreground font-normal">
                                <span>− Scenario withholding</span>
                                <span className="tabular-nums">−{formatNumber(Math.round(breakdown.scenarioWithholding))} sh</span>
                              </div>
                            ) : null}
                            <div className="flex justify-between text-muted-foreground font-normal">
                              <span>− Scenario sells</span>
                              <span className="tabular-nums">−{formatNumber(Math.round(breakdown.scenarioSellsTotal))} sh</span>
                            </div>
                            <div className="flex justify-between text-foreground">
                              <span>= Remaining</span>
                              <span className="tabular-nums">{formatNumber(Math.round(shares))} sh</span>
                            </div>
                          </div>
                        </div>
                      </details>
                      );
                    })}
                    <div className="flex justify-between font-semibold text-foreground border-t pt-1 mt-1">
                      <span>Total remaining</span>
                      <span>{formatMoney(remainingTotal, ccy)}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}
