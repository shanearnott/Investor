"use client";

import { useState } from "react";
import Link from "next/link";

import { CurrencySelector } from "@/components/currency-selector";
import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { convert } from "@/lib/fx";
import { lookupGrowthRate } from "@/lib/growth";
import { formatMoney, formatNumber } from "@/lib/utils";
import { currentAllocationBreakdown } from "@/lib/projections";
import { parseISO, vestedSharesAt, type Property, type StockHolding } from "@/lib/models";

/** RSU income-tax rates applied to the home-page "post-tax" net-worth
 *  tiles. Mirrors the scenarios page defaults — gives a quick at-a-glance
 *  read of net worth if you were taxed in each jurisdiction at vest. */
const POST_TAX_RATES: ReadonlyArray<{ label: string; rate: number }> = [
  { label: "Federal Only", rate: 37 },
  { label: "California", rate: 50 },
];

const LOOKAHEAD_OPTIONS = [3, 6, 9, 12, 18, 24, 36, 48] as const;
type LookaheadMonths = (typeof LOOKAHEAD_OPTIONS)[number];

export default function HomePage() {
  const { data, loadDemo, loading, displayCurrency } = useData();
  const [lookaheadMonths, setLookaheadMonths] = useState<LookaheadMonths>(6);

  const stocksCount = data.stocks.length;
  const propertiesCount = data.properties.length;
  const scenariosCount = data.scenarios.length;
  const projectsCount = data.projects.length;

  const allocation = currentAllocationBreakdown({
    holdings: data.stocks,
    properties: data.properties,
    settings: data.settings,
  });
  // currentAllocationBreakdown returns values in primary_currency; convert for display
  const todayPrimary = Object.values(allocation).reduce((s, v) => s + v, 0);
  const today = convert(todayPrimary, data.settings.primary_currency, displayCurrency, data.settings);

  // Split the gross-pre-tax total into property vs shares. Property entries
  // are keyed "<name> (property)"; everything else is share/equity value.
  const propertyGrossPrimary = Object.entries(allocation)
    .filter(([k]) => k.endsWith(" (property)"))
    .reduce((s, [, v]) => s + v, 0);
  const sharesGrossPrimary = todayPrimary - propertyGrossPrimary;
  const propertyGross = convert(propertyGrossPrimary, data.settings.primary_currency, displayCurrency, data.settings);
  const sharesGross = convert(sharesGrossPrimary, data.settings.primary_currency, displayCurrency, data.settings);

  // Vested RSU value (gross, in displayCurrency) — needed to derive the
  // post-tax tiles below. RSU income tax hits the value of vested RSU
  // shares at vest; non-RSU equity and property equity are untouched.
  const todayDate = new Date();
  const vestedRsuDisplay = data.stocks
    .filter((h) => h.equity_type === "RSU")
    .reduce((sum, h) => {
      const valueNative = vestedSharesAt(h, todayDate) * h.current_share_price;
      return sum + convert(valueNative, h.currency, displayCurrency, data.settings);
    }, 0);

  // Look-ahead window: equity tranches that will vest, plus expected property
  // growth between now and N months from now (user-selectable).
  const lookahead = computeLookahead({
    holdings: data.stocks,
    properties: data.properties,
    settings: data.settings,
    displayCurrency,
    months: lookaheadMonths,
  });

  const showWelcome = !loading && stocksCount === 0 && propertiesCount === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Investor</h1>
          <p className="text-sm text-muted-foreground">
            Personal investment tracker · scenario projections · project evaluation
          </p>
        </div>
        <CurrencySelector />
      </section>

      {showWelcome ? (
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>
              Try the demo to explore the app, or add your own data — it&apos;ll be saved in your browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={loadDemo}>Try with demo data</Button>
            <Link href="/investments">
              <Button variant="ghost">Add manually</Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link href="/investments" aria-label="Go to Stocks" className="block h-full">
          <Card className="h-full transition-colors hover:bg-accent">
            <CardHeader className="pb-2">
              <CardDescription>Stocks</CardDescription>
              <CardTitle className="text-2xl">{stocksCount}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/investments" aria-label="Go to Properties" className="block h-full">
          <Card className="h-full transition-colors hover:bg-accent">
            <CardHeader className="pb-2">
              <CardDescription>Properties</CardDescription>
              <CardTitle className="text-2xl">{propertiesCount}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/scenarios" aria-label="Go to Scenarios" className="block h-full">
          <Card className="h-full transition-colors hover:bg-accent">
            <CardHeader className="pb-2">
              <CardDescription>Scenarios</CardDescription>
              <CardTitle className="text-2xl">{scenariosCount}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/projects" aria-label="Go to Projects" className="block h-full">
          <Card className="h-full transition-colors hover:bg-accent">
            <CardHeader className="pb-2">
              <CardDescription>Projects</CardDescription>
              <CardTitle className="text-2xl">{projectsCount}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {today > 0 ? (
        <Link
          href="/projections"
          aria-label="Open Projections"
          className="block transition-colors"
        >
          <Card className="cursor-pointer hover:bg-accent">
            <CardHeader>
              <CardTitle>Gross (pre-tax) worth today</CardTitle>
              <CardDescription>
                Vested equity + property equity, before any tax on a sale or vest. Tap for projections.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">
                {formatMoney(today, displayCurrency)}
              </p>
              {(() => {
                // Secondary = whatever the user picked in Settings. If the
                // current display IS that currency, swap to the primary.
                const settingsPrimary = data.settings.primary_currency;
                const settingsSecondary = data.settings.secondary_currency;
                const secondary = displayCurrency === settingsSecondary
                  ? settingsPrimary
                  : settingsSecondary;
                if (secondary === displayCurrency) return null;
                const rates = data.settings.fx_rates ?? {};
                const haveRates = Boolean(rates[displayCurrency]) && Boolean(rates[secondary]);
                const inSecondary = convert(today, displayCurrency, secondary, data.settings);
                if (!haveRates) {
                  return (
                    <p className="text-sm text-amber-700 mt-1">
                      Set FX rate for <b>{displayCurrency}</b> and <b>{secondary}</b> in Settings to see the {secondary} equivalent.
                    </p>
                  );
                }
                return (
                  <p className="text-base text-foreground/80 tabular-nums mt-1">
                    ≈ {formatMoney(inSecondary, secondary)}
                  </p>
                );
              })()}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {(() => {
                  // Use the same secondary-currency selection as the hero
                  // total above: whatever the user picked in Settings,
                  // swapped to the primary if it matches the display.
                  const settingsPrimary = data.settings.primary_currency;
                  const settingsSecondary = data.settings.secondary_currency;
                  const secondary = displayCurrency === settingsSecondary
                    ? settingsPrimary
                    : settingsSecondary;
                  const rates = data.settings.fx_rates ?? {};
                  const haveRates = secondary !== displayCurrency
                    && Boolean(rates[displayCurrency])
                    && Boolean(rates[secondary]);
                  const sharesAlt = haveRates
                    ? convert(sharesGross, displayCurrency, secondary, data.settings)
                    : null;
                  const propertyAlt = haveRates
                    ? convert(propertyGross, displayCurrency, secondary, data.settings)
                    : null;
                  return (
                    <>
                      <div className="rounded-md border p-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          📊 Shares (pre-tax)
                        </div>
                        <div className="text-lg font-semibold tabular-nums">
                          {formatMoney(sharesGross, displayCurrency)}
                        </div>
                        {sharesAlt !== null ? (
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            ≈ {formatMoney(sharesAlt, secondary)}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-md border p-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          🏠 Property (pre-tax)
                        </div>
                        <div className="text-lg font-semibold tabular-nums">
                          {formatMoney(propertyGross, displayCurrency)}
                        </div>
                        {propertyAlt !== null ? (
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            ≈ {formatMoney(propertyAlt, secondary)}
                          </div>
                        ) : null}
                      </div>
                    </>
                  );
                })()}
              </div>
              {vestedRsuDisplay > 0 ? (
                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                    Post-tax (RSU income tax applied today)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {POST_TAX_RATES.map(({ label, rate }) => {
                      const value = today - vestedRsuDisplay * (rate / 100);
                      const subCcy = [data.settings.primary_currency, data.settings.secondary_currency]
                        .find((c) => c && c !== displayCurrency);
                      return (
                        <div key={label} className="rounded-md border p-2">
                          <div className="text-[11px] text-muted-foreground">
                            {label} <span className="tabular-nums">{rate}%</span>
                          </div>
                          <div className="text-base font-semibold tabular-nums">
                            {formatMoney(value, displayCurrency)}
                          </div>
                          {subCcy ? (
                            <div className="text-[10px] text-muted-foreground tabular-nums">
                              {formatMoney(convert(value, displayCurrency, subCcy, data.settings), subCcy)}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </Link>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Next {lookaheadMonths} months</CardTitle>
              <CardDescription>
                Vesting events and projected property growth between now and {lookahead.endLabel}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-muted-foreground">Look ahead</label>
              <Select
                value={String(lookaheadMonths)}
                onChange={(e) => setLookaheadMonths(Number(e.target.value) as LookaheadMonths)}
                className="h-8 w-[110px] text-xs"
              >
                {LOOKAHEAD_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m} months</option>
                ))}
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {lookahead.hasAny ? (
            <>
              {lookahead.vestingByStock.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Vesting by stock
                  </p>
                  <ul className="text-xs space-y-1">
                    {lookahead.vestingByStock.map((s) => (
                      <li
                        key={s.ticker}
                        className="flex justify-between gap-2 border-b pb-1 last:border-0"
                      >
                        <span>
                          <b>{s.ticker}</b>{" "}
                          <span className="text-muted-foreground">
                            · {s.events} event{s.events === 1 ? "" : "s"} ·{" "}
                            {s.firstDate === s.lastDate
                              ? s.firstDate
                              : `${s.firstDate} → ${s.lastDate}`}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {formatNumber(s.shares)} sh · {formatMoney(s.value, displayCurrency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {lookahead.vestingEvents.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Vesting events</p>
                  <ul className="text-xs space-y-1">
                    {(() => {
                      // Group adjacent events that share (date, ticker) so a stock
                      // with multiple tranches vesting the same day gets a subtotal.
                      const ev = lookahead.vestingEvents;
                      // Build a per-ticker percentile distribution from
                      // every (date, ticker) subtotal in the user's
                      // complete vesting schedule. Each stock is ranked
                      // against its own vests only — cross-stock
                      // comparison would mix grants of very different
                      // sizes and isn't meaningful. 🔥/🧊 stays stable
                      // as the look-ahead window changes.
                      const distByTicker = new Map<string, number[]>();
                      for (const h of data.stocks) {
                        const ticker = h.ticker || h.company_name || h.id;
                        const byDate = new Map<string, number>();
                        for (const tr of h.tranches) {
                          for (const vev of tr.vest_events) {
                            byDate.set(vev.vest_date, (byDate.get(vev.vest_date) ?? 0) + vev.shares);
                          }
                        }
                        const arr = Array.from(byDate.values()).sort((a, b) => a - b);
                        distByTicker.set(ticker, arr);
                      }
                      const emojiFor = (ticker: string, shares: number): string => {
                        const dist = distByTicker.get(ticker);
                        if (!dist || dist.length < 3) return "";
                        const rankIdx = dist.findIndex((v) => v >= shares);
                        const rank = rankIdx < 0 ? 1 : rankIdx / (dist.length - 1);
                        if (rank >= 0.8) return "🔥 ";
                        if (rank <= 0.2) return "🧊 ";
                        return "";
                      };
                      const out: React.ReactNode[] = [];
                      let i = 0;
                      while (i < ev.length) {
                        let j = i;
                        while (
                          j < ev.length &&
                          ev[j].date === ev[i].date &&
                          ev[j].ticker === ev[i].ticker
                        ) j++;
                        for (let k = i; k < j; k++) {
                          const e = ev[k];
                          out.push(
                            <li key={`e-${k}`} className="flex justify-between gap-2 border-b pb-1 last:border-0">
                              <span>
                                <b>{e.date}</b> · {e.ticker} <span className="text-muted-foreground">· {e.trancheName}</span>
                              </span>
                              <span className="tabular-nums">
                                {formatNumber(e.shares)} sh · {formatMoney(e.value, displayCurrency)}
                              </span>
                            </li>,
                          );
                        }
                        if (j - i > 1) {
                          const shares = ev.slice(i, j).reduce((s, x) => s + x.shares, 0);
                          const value = ev.slice(i, j).reduce((s, x) => s + x.value, 0);
                          out.push(
                            <li
                              key={`sub-${i}`}
                              className="flex justify-between gap-2 border-b pb-1 last:border-0 text-muted-foreground italic"
                            >
                              <span>
                                ↳ Subtotal · {emojiFor(ev[i].ticker, shares)}{ev[i].ticker} on {ev[i].date}
                              </span>
                              <span className="tabular-nums">
                                {formatNumber(shares)} sh · {formatMoney(value, displayCurrency)}
                              </span>
                            </li>,
                          );
                        }
                        i = j;
                      }
                      return out;
                    })()}
                  </ul>
                </div>
              ) : null}

              {lookahead.propertyGains.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Property growth</p>
                  <ul className="text-xs space-y-1">
                    {lookahead.propertyGains.map((p, i) => (
                      <li key={i} className="flex justify-between gap-2 border-b pb-1 last:border-0">
                        <span>{p.name} <span className="text-muted-foreground">({p.growthPct.toFixed(1)}%/yr)</span></span>
                        <span className="tabular-nums">+{formatMoney(p.gain, displayCurrency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nothing vesting and no property gains projected over the next {lookaheadMonths} months.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <b>Investments</b> → add stocks (with vesting schedules) and properties.
          </p>
          <p>
            <b>Scenarios</b> → save bear/base/bull cases with per-asset growth overrides.
          </p>
          <p>
            <b>Projections</b> → net worth over time (line + stacked-area &quot;sand&quot; chart) and allocation pies.
          </p>
          <p>
            <b>Projects</b> → model investment projects (e.g. buy a house). The app figures out whether your chosen funding sources cover the cost net of tax in a given scenario.
          </p>
          <p className="pt-2 text-xs text-muted-foreground">
            Data is stored locally in your browser (localStorage). Connect Google Drive in Settings to auto-sync across devices, or use the file backup option for an offline copy.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

type VestingEvent = {
  date: string;
  ticker: string;
  trancheName: string;
  shares: number;
  value: number; // in displayCurrency
};
type VestingByStock = {
  ticker: string;
  events: number;
  shares: number;
  value: number; // in displayCurrency
  firstDate: string;
  lastDate: string;
};
type PropertyGain = {
  name: string;
  gain: number; // in displayCurrency
  growthPct: number;
};

function computeLookahead(args: {
  holdings: StockHolding[];
  properties: Property[];
  settings: ReturnType<typeof useData>["data"]["settings"];
  displayCurrency: string;
  months: number;
}): {
  hasAny: boolean;
  endLabel: string;
  totalVestingShares: number;
  totalVestingValue: number;
  totalPropertyGain: number;
  vestingEvents: VestingEvent[];
  vestingByStock: VestingByStock[];
  propertyGains: PropertyGain[];
} {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + args.months, today.getUTCDate()));
  const endLabel = end.toISOString().slice(0, 10);

  const events: VestingEvent[] = [];
  let totalShares = 0;
  let totalValue = 0;

  for (const h of args.holdings) {
    for (const tr of h.tranches) {
      for (const ev of tr.vest_events) {
        const d = parseISO(ev.vest_date);
        if (!d) continue;
        if (d <= today || d > end) continue;
        const valueNative = ev.shares * h.current_share_price;
        const valueDisplay = convert(valueNative, h.currency, args.displayCurrency, args.settings);
        events.push({
          date: ev.vest_date,
          ticker: h.ticker || h.company_name || h.id,
          trancheName: tr.name || "Grant",
          shares: ev.shares,
          value: valueDisplay,
        });
        totalShares += ev.shares;
        totalValue += valueDisplay;
      }
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  // Per-stock rollup of upcoming vests so the user can see at a glance how
  // many shares each ticker is expected to vest over the window.
  const byStockMap = new Map<string, VestingByStock>();
  for (const e of events) {
    const cur = byStockMap.get(e.ticker);
    if (!cur) {
      byStockMap.set(e.ticker, {
        ticker: e.ticker,
        events: 1,
        shares: e.shares,
        value: e.value,
        firstDate: e.date,
        lastDate: e.date,
      });
    } else {
      cur.events += 1;
      cur.shares += e.shares;
      cur.value += e.value;
      if (e.date < cur.firstDate) cur.firstDate = e.date;
      if (e.date > cur.lastDate) cur.lastDate = e.date;
    }
  }
  const vestingByStock = Array.from(byStockMap.values()).sort((a, b) => b.value - a.value);

  const propertyGains: PropertyGain[] = [];
  let totalGain = 0;
  for (const p of args.properties) {
    const provider = lookupGrowthRate({
      country: p.country, region: p.region, suburb: p.suburb, postcode: p.postcode,
      fallback_pct: p.annual_growth_pct,
    });
    const annualPct = provider.rate;
    const monthly = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
    const projected = p.current_value * Math.pow(1 + monthly, args.months);
    const gainNative = projected - p.current_value;
    const gainDisplay = convert(gainNative, p.currency, args.displayCurrency, args.settings);
    if (gainDisplay > 0) {
      propertyGains.push({ name: p.name, gain: gainDisplay, growthPct: annualPct });
      totalGain += gainDisplay;
    }
  }
  propertyGains.sort((a, b) => b.gain - a.gain);

  return {
    hasAny: events.length > 0 || propertyGains.length > 0,
    endLabel,
    totalVestingShares: totalShares,
    totalVestingValue: totalValue,
    totalPropertyGain: totalGain,
    vestingEvents: events,
    vestingByStock,
    propertyGains,
  };
}
