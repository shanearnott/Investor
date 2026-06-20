/**
 * Projection engine. Builds a monthly net-worth series across a horizon, broken
 * down by category. All amounts in primary currency.
 */

import { convert } from "./fx";
import { lookupGrowthRate } from "./growth";
import {
  RSU_DEFAULT_TAX_RATES,
  defaultSaleTaxRate,
  eventNetReleaseShares,
  parseISO,
  totalGrantedShares,
  unvestedSharesAt,
  vestedSharesAt,
  type Property,
  type Scenario,
  type Settings,
  type StockHolding,
} from "./models";

export type ProjectionRow = {
  date: string; // ISO YYYY-MM-DD
  total: number;
  liquid_equity_total: number;
  unvested_equity_total: number;
  property_equity_total: number;
  property_gross_total: number;
  // Accumulated post-tax cash from sales whose sell date has passed.
  cash_total: number;
  // Gross value of shares released-but-not-yet-sold (held flat, keeps the
  // net-worth line continuous between a release date and a later sell date).
  pending_sale_total: number;
  // Post-tax proceeds from sales whose sell date lands in *this* step
  // (drives the bar on the chart).
  sale_proceeds_step: number;
  // Per-asset combined value (vested + unvested for stocks; equity for property)
  perAsset: Record<string, number>;
  // Optional inflation-adjusted total
  real_total?: number;
};

export type ProjectionConfig = {
  horizon_years: number;
  step_months: number; // default 1
  start?: Date;
};

function addMonths(d: Date, months: number): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  x.setUTCMonth(x.getUTCMonth() + months);
  return x;
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

/** First day of a date's month (UTC). The projection grid steps on month
 *  boundaries, so comparing a mid-month sale date directly would push its
 *  effect into the *next* monthly step. Snapping to the containing month
 *  makes a sale take effect in the month it actually happens. */
function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Return a copy of the holding with any tranche vest_events after the
 *  scenario's termination_date removed. Models "I leave / get terminated
 *  on this date — the remaining grants are forfeit." Off by default. */
function applyScenarioTermination(h: StockHolding, scenario: Scenario): StockHolding {
  const term = scenario.stock_overrides[h.id]?.termination_date;
  if (!term) return h;
  const limit = parseISO(term);
  if (!limit) return h;
  return {
    ...h,
    tranches: h.tranches.map((t) => ({
      ...t,
      vest_events: t.vest_events.filter((ev) => {
        const d = parseISO(ev.vest_date);
        return !d || d <= limit;
      }),
    })),
  };
}

/** Effective today's price for a stock under a scenario — defaults to the
 *  holding's actual price unless the scenario overrides it. */
export function startingPriceForScenario(
  s: Scenario,
  holding: Pick<StockHolding, "id" | "current_share_price">,
): number {
  const ov = s.stock_overrides[holding.id];
  if (ov?.starting_share_price !== undefined && ov.starting_share_price > 0) {
    return ov.starting_share_price;
  }
  return holding.current_share_price;
}

function stockGrowthForScenario(
  s: Scenario,
  holding: Pick<StockHolding, "id" | "current_share_price">,
): number {
  const ov = s.stock_overrides[holding.id];
  // Target price wins if set: derive the annual rate that takes the
  // *effective starting price* (override or actual) to the target over the
  // scenario's horizon.
  const startPrice = startingPriceForScenario(s, holding);
  if (ov?.target_share_price !== undefined && ov.target_share_price > 0 && startPrice > 0 && s.horizon_years > 0) {
    return (Math.pow(ov.target_share_price / startPrice, 1 / s.horizon_years) - 1) * 100;
  }
  return ov?.annual_price_growth_pct ?? s.default_stock_growth_pct;
}

function propertyGrowthForScenario(
  s: Scenario,
  propertyId: string,
  fallbackPct: number,
): number {
  const ov = s.property_overrides[propertyId]?.annual_growth_pct;
  if (ov !== undefined) return ov;
  return fallbackPct || s.default_property_growth_pct;
}

/** RSU income-tax rate (%) that applies to shares vesting in `year`.
 *  Uses the scenario's per-year override for that calendar year if present,
 *  otherwise the flat scenario rate. */
function rsuRateForYear(scenario: Scenario, year: number): number {
  const ov = scenario.rsu_tax_year_overrides?.[String(year)];
  return ov !== undefined ? ov : (scenario.rsu_tax_rate_pct ?? 0);
}

/** Net-of-RSU-tax value of an RSU holding split into vested / unvested as of
 *  `asOf`. Each vest event is taxed at the rate for its own vest year (per-
 *  year override or flat). Outright-owned shares vested in the past, so they
 *  take the flat rate. Returns native-currency amounts. */
function rsuValueNative(
  h: StockHolding,
  scenario: Scenario,
  asOf: Date,
  projectedPrice: number,
): { vested: number; unvested: number } {
  const flatFactor = Math.max(0, 1 - (scenario.rsu_tax_rate_pct ?? 0) / 100);

  // Aggregate at the holding level so vest_date / release_date drift
  // doesn't double-count: the user logs releases as quarters pass,
  // sometimes a day off the scheduled tranche date. Date matching
  // collapses there; counts hold regardless.
  let pastTrancheGross = 0;
  let futureTrancheGross = 0;
  for (const t of h.tranches) {
    for (const ev of t.vest_events) {
      const d = parseISO(ev.vest_date);
      if (!d) continue;
      if (d <= asOf) pastTrancheGross += ev.shares;
      else futureTrancheGross += ev.shares;
    }
  }

  let releaseGrossPast = 0;
  let keptHeldPast = 0;
  let releaseGrossFuture = 0;
  let releaseKeptFuture = 0;
  for (const s of h.sales ?? []) {
    const release = parseISO(s.release_date);
    if (!release) continue;
    const kept = eventNetReleaseShares(s);
    if (release <= asOf) {
      releaseGrossPast += s.shares;
      let sold = false;
      if (s.sell_date) {
        const sd = parseISO(s.sell_date);
        if (sd && sd <= asOf) sold = true;
      }
      if (!sold) keptHeldPast += kept;
    } else {
      releaseGrossFuture += s.shares;
      releaseKeptFuture += kept;
    }
  }

  // Income-tax bookkeeping:
  //   untaxed*  — tranche shares not yet "released" via an explicit
  //               event; tax is assumed payable at vest, haircut applies.
  //   taxPaid*  — kept shares from release events; income tax already
  //               paid via withholding, value at full projected price.
  const untaxedHeld = Math.max(0, pastTrancheGross - releaseGrossPast);
  const taxPaidHeld = keptHeldPast;
  const untaxedUnvested = Math.max(0, futureTrancheGross - releaseGrossFuture);
  const taxPaidUnvested = releaseKeptFuture;

  const vested =
    h.shares_owned_outright * projectedPrice * flatFactor
    + untaxedHeld * projectedPrice * flatFactor
    + taxPaidHeld * projectedPrice;
  const unvested =
    untaxedUnvested * projectedPrice * flatFactor
    + taxPaidUnvested * projectedPrice;

  return { vested: Math.max(0, vested), unvested };
}

export function projectStockValueAt(
  h: StockHolding,
  scenario: Scenario,
  asOf: Date,
  primaryCcy: string,
  settings: Settings,
) {
  const today = new Date();
  const monthsForward = Math.max(0, monthsBetween(today, asOf));
  const growthPct = stockGrowthForScenario(scenario, h);
  const monthlyGrowth = Math.pow(1 + growthPct / 100, 1 / 12) - 1;
  // Start from the scenario's override price if one is set (the "what if my
  // shares were already worth X today" override), otherwise the actual
  // current price. Growth compounds from there.
  const startPrice = startingPriceForScenario(scenario, h);
  const projectedPrice = startPrice * Math.pow(1 + monthlyGrowth, monthsForward);

  // Drop tranche vest_events past the scenario's termination_date (if
  // set) so vested / unvested counts and rsuValueNative all see the
  // forfeited grants as gone.
  const adjusted = applyScenarioTermination(h, scenario);

  const vested = vestedSharesAt(adjusted, asOf);
  // unvested = future tranche vests only. Don't infer it from
  // granted − vested: release/sale deductions on past vests would
  // otherwise leak into the "unvested" bucket.
  const unvested = unvestedSharesAt(adjusted, asOf);

  // RSUs: tax per vest year (override or flat). Non-RSU: untaxed here.
  let vestedNative: number;
  let unvestedNative: number;
  if (h.equity_type === "RSU") {
    const v = rsuValueNative(adjusted, scenario, asOf, projectedPrice);
    vestedNative = v.vested;
    unvestedNative = v.unvested;
  } else if (h.equity_type === "Stock Options") {
    // Per-option intrinsic value at the projected price; 0 when
    // underwater (current < strike). Strike comes off the holding.
    const intrinsic = Math.max(0, projectedPrice - (h.strike_price ?? 0));
    vestedNative = vested * intrinsic;
    unvestedNative = unvested * intrinsic;
  } else {
    vestedNative = vested * projectedPrice;
    unvestedNative = unvested * projectedPrice;
  }

  return {
    liquid: convert(vestedNative, h.currency, primaryCcy, settings),
    unvested: convert(unvestedNative, h.currency, primaryCcy, settings),
    shares_vested: vested,
    shares_unvested: unvested,
    projected_price: projectedPrice, // in native currency
    tax_factor: Math.max(0, 1 - (scenario.rsu_tax_rate_pct ?? 0) / 100),
  };
}

export function projectPropertyValueAt(
  p: Property,
  scenario: Scenario,
  asOf: Date,
  primaryCcy: string,
  settings: Settings,
) {
  const today = new Date();
  const monthsForward = Math.max(0, monthsBetween(today, asOf));
  const provider = lookupGrowthRate({
    country: p.country,
    region: p.region,
    suburb: p.suburb,
    postcode: p.postcode,
    fallback_pct: p.annual_growth_pct,
  });
  const growthPct = propertyGrowthForScenario(scenario, p.id, provider.rate);
  const monthlyGrowth = Math.pow(1 + growthPct / 100, 1 / 12) - 1;
  const projectedValueNative = p.current_value * Math.pow(1 + monthlyGrowth, monthsForward);
  const equityNative = projectedValueNative - p.mortgage_balance;
  return {
    gross: convert(projectedValueNative, p.currency, primaryCcy, settings),
    equity: convert(equityNative, p.currency, primaryCcy, settings),
    mortgage: convert(p.mortgage_balance, p.currency, primaryCcy, settings),
    growth_pct_used: growthPct,
    growth_source: provider.source,
    projected_value_native: projectedValueNative,
  };
}

export type ResolvedSale = {
  stockId: string;
  releaseDate: Date;
  sellDate: Date;
  shares: number;
  /** Post-sale-tax proceeds in settings.primary_currency. Earmarked shares
   *  are valued at this net amount for the whole projection, so a sale never
   *  causes a step in the net-worth line. */
  netPrimary: number;
};

/** Resolve a scenario's planned sales chronologically: cap shares at those
 *  vested by the release date (and not already earmarked by an earlier
 *  sale), and price each at sale_price or the projected price at sell date.
 *  Amounts are in settings.primary_currency. */
export function resolveScenarioSales(
  scenario: Scenario,
  holdings: StockHolding[],
  settings: Settings,
): ResolvedSale[] {
  const holdingsById = new Map(holdings.map((h) => [h.id, h]));
  const earmarked: Record<string, number> = {};
  const out: ResolvedSale[] = [];
  const dateKey = (s: { release_date?: string; date?: string }) => s.release_date ?? s.date ?? "";
  for (const s of [...(scenario.stock_sales ?? [])].sort((a, b) => dateKey(a).localeCompare(dateKey(b)))) {
    const h = holdingsById.get(s.stock_id);
    const releaseDate = parseISO(s.release_date ?? s.date ?? null);
    if (!h || !releaseDate) continue;
    const sellDate = parseISO(s.sell_date ?? s.release_date ?? s.date ?? null) ?? releaseDate;
    const adjusted = applyScenarioTermination(h, scenario);
    const vestedAtRelease = vestedSharesAt(adjusted, releaseDate);
    const available = Math.max(0, vestedAtRelease - (earmarked[s.stock_id] ?? 0));
    // Percentage takes precedence over fixed share count when set —
    // "sell N% of vested at release_date" rather than a literal share
    // number. Caps at the available (vested minus prior earmarks).
    const requestedShares =
      s.shares_pct !== undefined && s.shares_pct > 0
        ? vestedAtRelease * (Math.min(100, Math.max(0, s.shares_pct)) / 100)
        : s.shares;
    const shares = Math.min(requestedShares, available);
    earmarked[s.stock_id] = (earmarked[s.stock_id] ?? 0) + shares;
    if (shares <= 0) continue;
    const priceNative =
      s.sale_price !== undefined && s.sale_price > 0
        ? s.sale_price
        : projectStockValueAt(h, scenario, sellDate, settings.primary_currency, settings).projected_price;
    const grossNative = shares * priceNative;

    // Split-tax mode kicks in when the user has set either a release
    // jurisdiction or an explicit release tax rate. Otherwise the
    // existing single `tax_rate_pct` applies to gross (legacy).
    const splitTaxMode =
      !!s.release_jurisdiction || (s.release_tax_rate_pct ?? 0) > 0;
    let netNative: number;
    if (splitTaxMode) {
      const releasePriceNative =
        s.release_price !== undefined && s.release_price > 0
          ? s.release_price
          : projectStockValueAt(h, scenario, releaseDate, settings.primary_currency, settings).projected_price;
      const releaseRatePct =
        s.release_tax_rate_pct !== undefined
          ? s.release_tax_rate_pct
          : s.release_jurisdiction
            ? RSU_DEFAULT_TAX_RATES[s.release_jurisdiction] ?? 0
            : 0;
      const incomeTaxNative =
        shares * releasePriceNative * (Math.max(0, Math.min(100, releaseRatePct)) / 100);
      const perShareGain = Math.max(0, priceNative - releasePriceNative);
      const capGainsRatePct =
        s.tax_rate_pct > 0
          ? s.tax_rate_pct
          : s.sale_jurisdiction
            ? defaultSaleTaxRate(s.sale_jurisdiction)
            : 0;
      const capGainsTaxNative =
        shares * perShareGain * (Math.max(0, Math.min(100, capGainsRatePct)) / 100);
      netNative = grossNative - incomeTaxNative - capGainsTaxNative;
    } else {
      netNative = grossNative * (1 - Math.max(0, Math.min(100, s.tax_rate_pct)) / 100);
    }
    out.push({
      stockId: s.stock_id,
      releaseDate,
      sellDate,
      shares,
      netPrimary: convert(netNative, h.currency, settings.primary_currency, settings),
    });
  }
  return out;
}

export type HoldingSaleAccrual = {
  /** Vested shares to take out of the scenario-priced pool (sold, released,
   *  or vested-and-earmarked-but-not-yet-released). */
  scenarioRemovedShares: number;
  /** Net (post-sale-tax) value of vested-but-not-yet-released earmarked
   *  shares, held flat. These stay *in* the equity line — the shares are
   *  still held, just locked to the after-tax sale value rather than
   *  tracking the scenario price, so the sale causes no step at all. */
  lockedLiquid: number;
  /** Net (post-sale-tax) value of released-but-not-yet-sold shares
   *  (continuous net-worth bucket between the release and sell dates). */
  pending: number;
  /** Net (post-sale-tax) proceeds of sold shares. */
  cash: number;
};

/** Per-holding sale accrual at `asOf`. Earmarked shares are valued at the
 *  after-tax sale proceeds (override or projected-at-sell, less the sale
 *  tax) for the whole projection — they never track the scenario price and
 *  the value is identical while locked, pending and as cash — so a sale
 *  causes no step in the net-worth line. A sale's shares only start counting
 *  once they have vested (walked in release order). */
export function holdingSaleAccrual(
  resolvedForHolding: ResolvedSale[],
  vestedNow: number,
  asOf: Date,
): HoldingSaleAccrual {
  let scenarioRemovedShares = 0;
  let lockedLiquid = 0;
  let pending = 0;
  let cash = 0;
  let cum = 0;
  for (const r of resolvedForHolding) {
    const vestedPortion = Math.max(0, Math.min(r.shares, vestedNow - cum));
    cum += r.shares;
    if (r.shares <= 0) continue;
    const sold = monthStart(r.sellDate) <= asOf;
    const released = monthStart(r.releaseDate) <= asOf;
    if (sold) {
      cash += r.netPrimary;
      scenarioRemovedShares += r.shares;
    } else if (released) {
      pending += r.netPrimary;
      scenarioRemovedShares += r.shares;
    } else {
      lockedLiquid += r.netPrimary * (vestedPortion / r.shares);
      scenarioRemovedShares += vestedPortion;
    }
  }
  return { scenarioRemovedShares, lockedLiquid, pending, cash };
}

/** Group resolved sales by holding id, each list sorted by release date so
 *  cumulative vesting is walked in the right order. */
export function resolvedByHolding(resolved: ResolvedSale[]): Map<string, ResolvedSale[]> {
  const m = new Map<string, ResolvedSale[]>();
  for (const r of resolved) {
    const arr = m.get(r.stockId);
    if (arr) arr.push(r);
    else m.set(r.stockId, [r]);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => a.releaseDate.getTime() - b.releaseDate.getTime());
  }
  return m;
}

export function buildNetWorthSeries(args: {
  holdings: StockHolding[];
  properties: Property[];
  scenario: Scenario;
  settings: Settings;
  config: ProjectionConfig;
}): ProjectionRow[] {
  const { holdings, properties, scenario, settings, config } = args;
  const start = config.start ?? new Date();
  const startMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const totalMonths = config.horizon_years * 12;
  const step = config.step_months ?? 1;
  const rows: ProjectionRow[] = [];

  const inflMonthly = scenario.inflation_pct
    ? Math.pow(1 + scenario.inflation_pct / 100, 1 / 12) - 1
    : 0;

  const resolvedSales = resolveScenarioSales(scenario, holdings, settings);
  const salesByHolding = resolvedByHolding(resolvedSales);

  for (let i = 0; i <= totalMonths; i += step) {
    const asOf = addMonths(startMonth, i);
    const prevAsOf = addMonths(startMonth, Math.max(0, i - step));
    const perAsset: Record<string, number> = {};
    let liquid = 0, unvested = 0, propEq = 0, propGross = 0, cashTotal = 0, pendingTotal = 0;

    // Bar slice: proceeds whose sell date lands in this step.
    let saleStep = 0;
    for (const r of resolvedSales) {
      const sellMonth = monthStart(r.sellDate);
      if (sellMonth <= asOf && (i === 0 || sellMonth > prevAsOf)) saleStep += r.netPrimary;
    }

    for (const h of holdings) {
      const v = projectStockValueAt(h, scenario, asOf, settings.primary_currency, settings);
      const acc = holdingSaleAccrual(salesByHolding.get(h.id) ?? [], v.shares_vested, asOf);
      // Free (non-earmarked) vested shares track the scenario price; earmarked
      // shares are valued at the locked sale price (lockedLiquid here, then
      // pending, then cash) so the sale never causes a scenario-vs-override
      // jump — the only step is the sale tax on the sell date.
      const free = Math.max(0, v.shares_vested - acc.scenarioRemovedShares);
      const liquidFree = v.shares_vested > 0 ? v.liquid * (free / v.shares_vested) : 0;
      const liquidAdj = liquidFree + acc.lockedLiquid;
      const label = `stock:${h.ticker || h.company_name || h.id}`;
      perAsset[label] = liquidAdj + v.unvested;
      liquid += liquidAdj;
      unvested += v.unvested;
      cashTotal += acc.cash;
      pendingTotal += acc.pending;
    }
    for (const p of properties) {
      const v = projectPropertyValueAt(p, scenario, asOf, settings.primary_currency, settings);
      const label = `property:${p.name || p.id}`;
      perAsset[label] = v.equity;
      propEq += v.equity;
      propGross += v.gross;
    }

    const total = liquid + unvested + propEq + cashTotal + pendingTotal;
    const row: ProjectionRow = {
      date: asOf.toISOString().slice(0, 10),
      total,
      liquid_equity_total: liquid,
      unvested_equity_total: unvested,
      property_equity_total: propEq,
      property_gross_total: propGross,
      cash_total: cashTotal,
      pending_sale_total: pendingTotal,
      sale_proceeds_step: saleStep,
      perAsset,
    };
    if (inflMonthly > 0) {
      row.real_total = total / Math.pow(1 + inflMonthly, i);
    }
    rows.push(row);
  }
  return rows;
}

export function currentAllocationBreakdown(args: {
  holdings: StockHolding[];
  properties: Property[];
  settings: Settings;
}): Record<string, number> {
  const today = new Date();
  const snapshot: Scenario = {
    id: "snap",
    name: "snap",
    description: "",
    horizon_years: 0,
    default_stock_growth_pct: 0,
    default_property_growth_pct: 0,
    stock_overrides: {},
    property_overrides: {},
    inflation_pct: 0,
    rsu_tax_jurisdiction: "California",
    rsu_tax_rate_pct: 0,
    rsu_tax_year_overrides: {},
    stock_sales: [],
  };
  const out: Record<string, number> = {};
  for (const h of args.holdings) {
    const v = projectStockValueAt(h, snapshot, today, args.settings.primary_currency, args.settings);
    const cur = v.liquid;
    if (cur > 0) {
      const key = `${h.ticker || h.company_name} (vested)`;
      out[key] = (out[key] ?? 0) + cur;
    }
  }
  for (const p of args.properties) {
    const v = projectPropertyValueAt(p, snapshot, today, args.settings.primary_currency, args.settings);
    if (v.equity > 0) {
      out[`${p.name} (property)`] = v.equity;
    }
  }
  return out;
}

export function futureAllocationBreakdown(args: {
  holdings: StockHolding[];
  properties: Property[];
  scenario: Scenario;
  settings: Settings;
  atYearOffset?: number;
}): Record<string, number> {
  const yrs = args.atYearOffset ?? args.scenario.horizon_years;
  const asOf = new Date();
  asOf.setUTCFullYear(asOf.getUTCFullYear() + yrs);
  const out: Record<string, number> = {};
  for (const h of args.holdings) {
    const v = projectStockValueAt(h, args.scenario, asOf, args.settings.primary_currency, args.settings);
    const total = v.liquid + v.unvested;
    if (total > 0) out[h.ticker || h.company_name || h.id] = total;
  }
  for (const p of args.properties) {
    const v = projectPropertyValueAt(p, args.scenario, asOf, args.settings.primary_currency, args.settings);
    if (v.equity > 0) out[`${p.name} (property)`] = v.equity;
  }
  return out;
}
