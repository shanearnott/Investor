"use client";

import Link from "next/link";

import { CurrencySelector } from "@/components/currency-selector";
import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { convert } from "@/lib/fx";
import { lookupGrowthRate } from "@/lib/growth";
import { formatMoney, formatNumber } from "@/lib/utils";
import { currentAllocationBreakdown } from "@/lib/projections";
import { parseISO, type Property, type StockHolding } from "@/lib/models";

export default function HomePage() {
  const { data, loadDemo, loading, displayCurrency } = useData();

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

  // Next 3 months: equity tranches that will vest, plus expected property growth
  const next3 = nextThreeMonthsOutlook({
    holdings: data.stocks,
    properties: data.properties,
    settings: data.settings,
    displayCurrency,
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
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Stocks</CardDescription>
            <CardTitle className="text-2xl">{stocksCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Properties</CardDescription>
            <CardTitle className="text-2xl">{propertiesCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Scenarios</CardDescription>
            <CardTitle className="text-2xl">{scenariosCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Projects</CardDescription>
            <CardTitle className="text-2xl">{projectsCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {today > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Vested net worth today</CardTitle>
            <CardDescription>
              Liquid + vested-but-pre-trigger equity + property equity, in {displayCurrency}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {formatMoney(today, displayCurrency)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              See <Link href="/projections" className="underline">Projections</Link> for the full picture.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {next3.hasAny ? (
        <Card>
          <CardHeader>
            <CardTitle>Next 3 months</CardTitle>
            <CardDescription>
              Vesting events and projected property growth between now and {next3.endLabel}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Equity vesting" value={formatMoney(next3.totalVestingValue, displayCurrency)} sub={`${formatNumber(next3.totalVestingShares)} shares across ${next3.vestingEvents.length} event${next3.vestingEvents.length === 1 ? "" : "s"}`} />
              <Stat label="Property growth" value={formatMoney(next3.totalPropertyGain, displayCurrency)} sub={`across ${next3.propertyGains.length} propert${next3.propertyGains.length === 1 ? "y" : "ies"}`} />
              <Stat label="Combined" value={formatMoney(next3.totalVestingValue + next3.totalPropertyGain, displayCurrency)} />
            </div>

            {next3.vestingEvents.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Vesting events</p>
                <ul className="text-xs space-y-1">
                  {next3.vestingEvents.map((e, i) => (
                    <li key={i} className="flex justify-between gap-2 border-b pb-1 last:border-0">
                      <span>
                        <b>{e.date}</b> · {e.ticker}
                        {e.preTrigger ? <span className="ml-1 text-amber-700">(pre-trigger)</span> : null}
                      </span>
                      <span className="tabular-nums">
                        {formatNumber(e.shares)} sh · {formatMoney(e.value, displayCurrency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {next3.propertyGains.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Property growth</p>
                <ul className="text-xs space-y-1">
                  {next3.propertyGains.map((p, i) => (
                    <li key={i} className="flex justify-between gap-2 border-b pb-1 last:border-0">
                      <span>{p.name} <span className="text-muted-foreground">({p.growthPct.toFixed(1)}%/yr)</span></span>
                      <span className="tabular-nums">+{formatMoney(p.gain, displayCurrency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {next3.preTriggerNote ? (
              <p className="text-[11px] text-muted-foreground">
                Pre-trigger means those vests don&apos;t become liquid until the second trigger (e.g. IPO) — they accrue but you can&apos;t sell.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <b>Investments</b> → add stocks (with vesting + second-trigger date for double-trigger RSUs) and properties.
          </p>
          <p>
            <b>Scenarios</b> → save bear/base/bull cases with per-asset growth and IPO-date overrides.
          </p>
          <p>
            <b>Projections</b> → net worth over time (line + stacked-area &quot;sand&quot; chart) and allocation pies.
          </p>
          <p>
            <b>Projects</b> → model investment projects (e.g. buy a house). The app figures out whether your chosen funding sources cover the cost net of tax in a given scenario.
          </p>
          <p className="pt-2 text-xs text-muted-foreground">
            Data is stored locally in your browser (localStorage). Drive sync coming next.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-[10px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

type VestingEvent = {
  date: string;
  ticker: string;
  shares: number;
  value: number; // in displayCurrency
  preTrigger: boolean;
};
type PropertyGain = {
  name: string;
  gain: number; // in displayCurrency
  growthPct: number;
};

function nextThreeMonthsOutlook(args: {
  holdings: StockHolding[];
  properties: Property[];
  settings: ReturnType<typeof useData>["data"]["settings"];
  displayCurrency: string;
}): {
  hasAny: boolean;
  endLabel: string;
  totalVestingShares: number;
  totalVestingValue: number;
  totalPropertyGain: number;
  vestingEvents: VestingEvent[];
  propertyGains: PropertyGain[];
  preTriggerNote: boolean;
} {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, today.getUTCDate()));
  const endLabel = end.toISOString().slice(0, 10);

  const events: VestingEvent[] = [];
  let totalShares = 0;
  let totalValue = 0;
  let preTriggerSeen = false;

  for (const h of args.holdings) {
    const isDouble = h.equity_type === "RSU (double trigger)";
    const triggerDate = parseISO(h.second_trigger_date ?? null);
    for (const t of h.vesting_schedule) {
      const d = parseISO(t.vest_date);
      if (!d) continue;
      if (d <= today || d > end) continue;
      const valueNative = t.shares * h.current_share_price;
      const valueDisplay = convert(valueNative, h.currency, args.displayCurrency, args.settings);
      const preTrigger = isDouble && triggerDate ? d < triggerDate : false;
      if (preTrigger) preTriggerSeen = true;
      events.push({
        date: t.vest_date,
        ticker: h.ticker || h.company_name || h.id,
        shares: t.shares,
        value: valueDisplay,
        preTrigger,
      });
      totalShares += t.shares;
      totalValue += valueDisplay;
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
    // 3-month gain on current value, compounded monthly
    const monthly = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
    const projected = p.current_value * Math.pow(1 + monthly, 3);
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
    preTriggerNote: preTriggerSeen,
  };
}
