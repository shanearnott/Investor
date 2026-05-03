/**
 * Projection engine. Builds a monthly net-worth series across a horizon, broken
 * down by category. All amounts in primary currency.
 */

import { convert } from "./fx";
import { lookupGrowthRate } from "./growth";
import {
  totalGrantedShares,
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

/** Effective today's price for a stock under a scenario — defaults to the
 *  holding's actual price unless the scenario overrides it. */
function startingPriceForScenario(
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

/** RSU income-tax factor for a holding under a scenario.
 *  Non-RSU holdings pass through. The scenario picks one jurisdiction +
 *  rate that applies to *all* RSU holdings — so this models "what if I
 *  was taxed in jurisdiction X" regardless of where the grant is held. */
function rsuTaxFactor(scenario: Scenario, h: Pick<StockHolding, "equity_type">): number {
  if (h.equity_type !== "RSU") return 1;
  return Math.max(0, 1 - (scenario.rsu_tax_rate_pct ?? 0) / 100);
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

  const vested = vestedSharesAt(h, asOf);
  const granted = totalGrantedShares(h);
  const unvested = Math.max(0, granted - vested);
  const taxFactor = rsuTaxFactor(scenario, h);

  return {
    liquid: convert(vested * projectedPrice * taxFactor, h.currency, primaryCcy, settings),
    unvested: convert(unvested * projectedPrice * taxFactor, h.currency, primaryCcy, settings),
    shares_vested: vested,
    shares_unvested: unvested,
    projected_price: projectedPrice, // in native currency
    tax_factor: taxFactor,
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

  for (let i = 0; i <= totalMonths; i += step) {
    const asOf = addMonths(startMonth, i);
    const perAsset: Record<string, number> = {};
    let liquid = 0, unvested = 0, propEq = 0, propGross = 0;

    for (const h of holdings) {
      const v = projectStockValueAt(h, scenario, asOf, settings.primary_currency, settings);
      const label = `stock:${h.ticker || h.company_name || h.id}`;
      perAsset[label] = v.liquid + v.unvested;
      liquid += v.liquid;
      unvested += v.unvested;
    }
    for (const p of properties) {
      const v = projectPropertyValueAt(p, scenario, asOf, settings.primary_currency, settings);
      const label = `property:${p.name || p.id}`;
      perAsset[label] = v.equity;
      propEq += v.equity;
      propGross += v.gross;
    }

    const total = liquid + unvested + propEq;
    const row: ProjectionRow = {
      date: asOf.toISOString().slice(0, 10),
      total,
      liquid_equity_total: liquid,
      unvested_equity_total: unvested,
      property_equity_total: propEq,
      property_gross_total: propGross,
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
