"use client";

import { useMemo, useState } from "react";
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
import {
  releaseKeptShares,
  sellSharesFor,
  parseISO,
  unvestedSharesAt,
  vestedSharesAt,
  type Property,
  type StockHolding,
} from "@/lib/models";

/** Shares-to-vest look-ahead window options (months). The user can also
 *  override with a specific date via the home-page look-ahead card. */

const LOOKAHEAD_OPTIONS = [3, 6, 9, 12, 18, 24, 36, 48] as const;
type LookaheadMonths = (typeof LOOKAHEAD_OPTIONS)[number];

export default function HomePage() {
  const { data, loadDemo, loading, displayCurrency } = useData();
  const [lookaheadMonths, setLookaheadMonths] = useState<LookaheadMonths>(6);
  // Optional explicit cut-off date. When set, overrides the months dropdown
  // and the lookahead window runs today → customEndDate inclusive.
  const [customEndDate, setCustomEndDate] = useState<string>("");

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

  // Value (gross, in displayCurrency) of RSU vests whose income tax has
  // NOT yet been paid via a logged release event — i.e. tranche
  // vest_events whose date isn't shadowed by a release event. The
  // post-tax haircut below only applies to this portion; released
  // shares already paid income tax via withholding and shouldn't be
  // taxed a second time. Non-RSU equity and property are untouched.
  const todayDate = new Date();
  const preTaxRsuValue = data.stocks
    .filter((h) => h.equity_type === "RSU")
    .reduce((sum, h) => {
      // Count-based aggregate at the holding level. Past tranche shares
      // not "covered" by an explicit release event are assumed pre-tax;
      // released gross is treated as tax-paid via withholding. This
      // avoids the double-counting that exact vest_date / release_date
      // matching produces when the user logs releases on the actual
      // day rather than the scheduled day.
      let pastTrancheGross = 0;
      for (const t of h.tranches) {
        for (const ev of t.vest_events) {
          const d = parseISO(ev.vest_date);
          if (d && d <= todayDate) pastTrancheGross += ev.shares;
        }
      }
      let releaseGrossPast = 0;
      for (const r of h.releases ?? []) {
        const release = parseISO(r.release_date);
        if (release && release <= todayDate) releaseGrossPast += r.shares;
      }
      const preTaxShares = Math.max(0, pastTrancheGross - releaseGrossPast);
      const valueNative = preTaxShares * h.current_share_price;
      return sum + convert(valueNative, h.currency, displayCurrency, data.settings);
    }, 0);
  // Companion to preTaxRsuValue: value of RSU shares that HAVE been
  // released (income tax already paid via withholding). Used to expose
  // the tax-paid vs tax-owed split on the shares tile — the aggregate
  // sharesGross sums both, which is why the "pre-tax" label was
  // misleading on its own.
  const taxPaidRsuValue = data.stocks
    .filter((h) => h.equity_type === "RSU")
    .reduce((sum, h) => {
      let releaseKeptPast = 0;
      for (const r of h.releases ?? []) {
        const release = parseISO(r.release_date);
        if (release && release <= todayDate) releaseKeptPast += releaseKeptShares(r);
      }
      let soldPast = 0;
      for (const s of h.sells ?? []) {
        const sd = parseISO(s.sell_date);
        if (!sd || sd > todayDate) continue;
        const rel = (h.releases ?? []).find((r) => r.id === s.release_id) ?? null;
        soldPast += sellSharesFor(s, rel);
      }
      const heldTaxPaid = Math.max(0, releaseKeptPast - soldPast);
      const valueNative = heldTaxPaid * h.current_share_price;
      return sum + convert(valueNative, h.currency, displayCurrency, data.settings);
    }, 0);

  // Unvested ("still to vest") gross value across all stocks, in display
  // currency. Options use intrinsic so an underwater grant reads as 0
  // rather than full-price.
  const toVestGross = data.stocks.reduce((sum, h) => {
    const unvested = unvestedSharesAt(h, todayDate);
    const perShare = h.equity_type === "Stock Options"
      ? Math.max(0, h.current_share_price - (h.strike_price ?? 0))
      : h.current_share_price;
    const native = unvested * perShare;
    return sum + convert(native, h.currency, displayCurrency, data.settings);
  }, 0);

  // Look-ahead window: equity tranches that will vest, plus expected
  // property growth between now and the chosen cut-off. A valid
  // customEndDate wins over the months dropdown.
  const lookaheadEndDate = useMemo(() => {
    const today = new Date();
    if (customEndDate) {
      const parsed = parseISO(customEndDate);
      if (parsed && parsed > today) return parsed;
    }
    return new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth() + lookaheadMonths,
      today.getUTCDate(),
    ));
  }, [customEndDate, lookaheadMonths]);
  const lookaheadMode: "months" | "date" =
    customEndDate && parseISO(customEndDate) && parseISO(customEndDate)! > new Date()
      ? "date"
      : "months";
  const lookahead = computeLookahead({
    holdings: data.stocks,
    properties: data.properties,
    settings: data.settings,
    displayCurrency,
    endDate: lookaheadEndDate,
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
              <CardTitle>Worth today</CardTitle>
              <CardDescription>
                Vested equity + property equity at today&apos;s prices. RSU
                shares released via a logged event have income tax already
                deducted (via withholding); vested RSUs without a release
                are still pre-income-tax. Cap-gains on any sale sits on
                top — see the after-tax tile. Tap for projections.
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
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                  const toVestAlt = haveRates
                    ? convert(toVestGross, displayCurrency, secondary, data.settings)
                    : null;
                  const propertyAlt = haveRates
                    ? convert(propertyGross, displayCurrency, secondary, data.settings)
                    : null;
                  return (
                    <>
                      <div className="rounded-md border p-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          📊 Vested shares
                        </div>
                        <div className="text-lg font-semibold tabular-nums">
                          {formatMoney(sharesGross, displayCurrency)}
                        </div>
                        {sharesAlt !== null ? (
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            ≈ {formatMoney(sharesAlt, secondary)}
                          </div>
                        ) : null}
                        {(() => {
                          // Headline = outright + non-RSU vested + untaxed
                          // RSU + tax-paid RSU. The two RSU sub-lines don't
                          // cover outright shares or non-RSU equity, so
                          // without this third line the subtotals wouldn't
                          // sum to the headline.
                          const otherEquity = Math.max(
                            0,
                            sharesGross - taxPaidRsuValue - preTaxRsuValue,
                          );
                          const anyRsu = taxPaidRsuValue > 0 || preTaxRsuValue > 0;
                          if (!anyRsu && otherEquity <= 0) return null;
                          return (
                            <div className="mt-1 text-[10px] text-muted-foreground leading-tight">
                              {taxPaidRsuValue > 0 ? (
                                <div>
                                  Released RSU (tax-paid): {formatMoney(taxPaidRsuValue, displayCurrency)}
                                </div>
                              ) : null}
                              {preTaxRsuValue > 0 ? (
                                <div>
                                  Unreleased RSU (tax owed): {formatMoney(preTaxRsuValue, displayCurrency)}
                                </div>
                              ) : null}
                              {otherEquity > 0.5 ? (
                                <div>
                                  Other equity (outright + options / common): {formatMoney(otherEquity, displayCurrency)}
                                </div>
                              ) : null}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="rounded-md border p-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          🌱 To vest
                        </div>
                        <div className="text-lg font-semibold tabular-nums">
                          {formatMoney(toVestGross, displayCurrency)}
                        </div>
                        {toVestAlt !== null ? (
                          <div className="text-[10px] text-muted-foreground tabular-nums">
                            ≈ {formatMoney(toVestAlt, secondary)}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-md border p-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          🏠 Property equity
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
            </CardContent>
          </Card>
        </Link>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>
                {lookaheadMode === "date"
                  ? `Through ${lookahead.endLabel}`
                  : `Next ${lookaheadMonths} months`}
              </CardTitle>
              <CardDescription>
                Vesting events and projected property growth between now and {lookahead.endLabel}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-muted-foreground">Look ahead</label>
                <Select
                  value={String(lookaheadMonths)}
                  onChange={(e) => {
                    setLookaheadMonths(Number(e.target.value) as LookaheadMonths);
                    setCustomEndDate("");
                  }}
                  className="h-8 w-[110px] text-xs"
                  disabled={lookaheadMode === "date"}
                >
                  {LOOKAHEAD_OPTIONS.map((m) => (
                    <option key={m} value={m}>{m} months</option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-muted-foreground">Until date</label>
                <input
                  type="date"
                  value={customEndDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                />
                {customEndDate ? (
                  <button
                    type="button"
                    onClick={() => setCustomEndDate("")}
                    className="h-8 rounded-md border bg-background px-2 text-[11px] text-muted-foreground hover:bg-accent"
                    title="Clear date and use the dropdown"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
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
                        // If every vest on this ticker is the same size,
                        // there's no "good" or "bad" period to highlight.
                        if (dist[0] === dist[dist.length - 1]) return "";
                        const rankIdx = dist.findIndex((v) => v >= shares);
                        const rank = rankIdx < 0 ? 1 : rankIdx / (dist.length - 1);
                        if (rank >= 0.9) return "🔥 ";
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
              Nothing vesting and no property gains projected {lookaheadMode === "date"
                ? `through ${lookahead.endLabel}`
                : `over the next ${lookaheadMonths} months`}.
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
  endDate: Date;
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
  const end = args.endDate;
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
        // For Stock Options, value = intrinsic per option (= max(0,
        // price − strike)) × count; everything else uses price directly.
        const perShareNative = h.equity_type === "Stock Options"
          ? Math.max(0, h.current_share_price - (h.strike_price ?? 0))
          : h.current_share_price;
        const valueNative = ev.shares * perShareNative;
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
  // Months between today and the chosen end, measured in fractional
  // months so a custom date (not month-aligned) still compounds the
  // right distance.
  const monthsSpan = Math.max(
    0,
    (end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30.4375),
  );
  for (const p of args.properties) {
    const provider = lookupGrowthRate({
      country: p.country, region: p.region, suburb: p.suburb, postcode: p.postcode,
      fallback_pct: p.annual_growth_pct,
    });
    const annualPct = provider.rate;
    const monthly = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
    const projected = p.current_value * Math.pow(1 + monthly, monthsSpan);
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
