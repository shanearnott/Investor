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
  { label: "US", rate: 37 },
  { label: "AUS", rate: 51 },
  { label: "UAE", rate: 0 },
];

const LOOKAHEAD_OPTIONS = [3, 6, 9, 12, 18, 24] as const;
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
              {vestedRsuDisplay > 0 ? (
                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                    Post-tax (RSU income tax applied today)
                  </p>
                  <div className="grid grid-cols-3 gap-2">
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
              {lookahead.vestingEvents.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Vesting events</p>
                  <ul className="text-xs space-y-1">
                    {(() => {
                      // Group adjacent events that share (date, ticker) so a stock
                      // with multiple tranches vesting the same day gets a subtotal.
                      const ev = lookahead.vestingEvents;
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
                                ↳ Subtotal · {ev[i].ticker} on {ev[i].date}
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
    propertyGains,
  };
}
