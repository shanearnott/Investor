/**
 * Tax module — indicative top-marginal estimates per jurisdiction. Not tax advice.
 * User-overridable in Settings.
 */

import type { Settings } from "./models";

export type TaxRules = {
  jurisdiction: string;
  ordinary_income_rate: number;
  short_term_cap_gains_rate: number;
  long_term_cap_gains_rate: number;
  long_term_threshold_years: number;
  cgt_discount_pct: number; // 0..100
  rsu_vest_taxed_as_income: boolean;
  property_cgt_rate: number;
  property_cgt_discount_pct: number;
  primary_residence_exempt: boolean;
  notes?: string;
};

export const DEFAULTS: Record<string, TaxRules> = {
  California: {
    jurisdiction: "California",
    ordinary_income_rate: 0.50,
    short_term_cap_gains_rate: 0.50,
    long_term_cap_gains_rate: 0.333,
    long_term_threshold_years: 1.0,
    cgt_discount_pct: 0,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0.333,
    property_cgt_discount_pct: 0,
    primary_residence_exempt: false,
    notes:
      "Federal LTCG 20% + CA top 13.3%. RSUs taxed as ordinary income at vest (cost basis = vest price).",
  },
  "US-Federal-Only": {
    jurisdiction: "US-Federal-Only",
    ordinary_income_rate: 0.37,
    short_term_cap_gains_rate: 0.37,
    long_term_cap_gains_rate: 0.238,
    long_term_threshold_years: 1.0,
    cgt_discount_pct: 0,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0.238,
    property_cgt_discount_pct: 0,
    primary_residence_exempt: false,
  },
  Australia: {
    jurisdiction: "Australia",
    ordinary_income_rate: 0.47,
    short_term_cap_gains_rate: 0.47,
    long_term_cap_gains_rate: 0.47,
    long_term_threshold_years: 1.0,
    cgt_discount_pct: 50,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0.47,
    property_cgt_discount_pct: 50,
    primary_residence_exempt: true,
    notes:
      "50% CGT discount on assets held >12mo. ESS shares taxed as income at deferred taxing point.",
  },
  UAE: {
    jurisdiction: "UAE",
    ordinary_income_rate: 0,
    short_term_cap_gains_rate: 0,
    long_term_cap_gains_rate: 0,
    long_term_threshold_years: 0,
    cgt_discount_pct: 0,
    rsu_vest_taxed_as_income: false,
    property_cgt_rate: 0,
    property_cgt_discount_pct: 0,
    primary_residence_exempt: true,
    notes: "No personal income tax or CGT for individuals.",
  },
  UK: {
    jurisdiction: "UK",
    ordinary_income_rate: 0.45,
    short_term_cap_gains_rate: 0.24,
    long_term_cap_gains_rate: 0.24,
    long_term_threshold_years: 0,
    cgt_discount_pct: 0,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0.24,
    property_cgt_discount_pct: 0,
    primary_residence_exempt: true,
  },
  Singapore: {
    jurisdiction: "Singapore",
    ordinary_income_rate: 0.24,
    short_term_cap_gains_rate: 0,
    long_term_cap_gains_rate: 0,
    long_term_threshold_years: 0,
    cgt_discount_pct: 0,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0,
    property_cgt_discount_pct: 0,
    primary_residence_exempt: true,
    notes: "No CGT. RSUs taxed as employment income at vest.",
  },
  Canada: {
    jurisdiction: "Canada",
    ordinary_income_rate: 0.535,
    short_term_cap_gains_rate: 0.2675,
    long_term_cap_gains_rate: 0.2675,
    long_term_threshold_years: 0,
    cgt_discount_pct: 50,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0.2675,
    property_cgt_discount_pct: 50,
    primary_residence_exempt: true,
  },
  Germany: {
    jurisdiction: "Germany",
    ordinary_income_rate: 0.45,
    short_term_cap_gains_rate: 0.2638,
    long_term_cap_gains_rate: 0.2638,
    long_term_threshold_years: 0,
    cgt_discount_pct: 0,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0.45,
    property_cgt_discount_pct: 0,
    primary_residence_exempt: true,
    notes: "Property gains tax-free if held >10 years.",
  },
  "New Zealand": {
    jurisdiction: "New Zealand",
    ordinary_income_rate: 0.39,
    short_term_cap_gains_rate: 0,
    long_term_cap_gains_rate: 0,
    long_term_threshold_years: 0,
    cgt_discount_pct: 0,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0,
    property_cgt_discount_pct: 0,
    primary_residence_exempt: true,
  },
  "Hong Kong": {
    jurisdiction: "Hong Kong",
    ordinary_income_rate: 0.17,
    short_term_cap_gains_rate: 0,
    long_term_cap_gains_rate: 0,
    long_term_threshold_years: 0,
    cgt_discount_pct: 0,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0,
    property_cgt_discount_pct: 0,
    primary_residence_exempt: true,
  },
  Ireland: {
    jurisdiction: "Ireland",
    ordinary_income_rate: 0.52,
    short_term_cap_gains_rate: 0.33,
    long_term_cap_gains_rate: 0.33,
    long_term_threshold_years: 0,
    cgt_discount_pct: 0,
    rsu_vest_taxed_as_income: true,
    property_cgt_rate: 0.33,
    property_cgt_discount_pct: 0,
    primary_residence_exempt: true,
  },
};

export function getRules(jurisdiction: string, settings?: Settings): TaxRules {
  const base = DEFAULTS[jurisdiction] ?? DEFAULTS["US-Federal-Only"];
  const ov = settings?.tax_overrides?.[jurisdiction];
  if (!ov) return base;
  const merged: TaxRules = { ...base };
  for (const k of Object.keys(ov) as (keyof TaxRules)[]) {
    const v = ov[k];
    if (v === undefined) continue;
    // assign with relaxed typing — values are number or boolean
    (merged as Record<string, unknown>)[k as string] = v as never;
  }
  return merged;
}

export type StockSaleResult = {
  gross_proceeds: number;
  cost_basis_total: number;
  gain: number;
  tax: number;
  net_proceeds: number;
  effective_rate_on_gain: number;
  rules_used: string;
};

export function stockSaleTax(args: {
  jurisdiction: string;
  sale_price_per_share: number;
  cost_basis_per_share: number;
  shares: number;
  holding_period_years: number;
  settings?: Settings;
}): StockSaleResult {
  const rules = getRules(args.jurisdiction, args.settings);
  const gross = args.sale_price_per_share * args.shares;
  const gain = Math.max(0, (args.sale_price_per_share - args.cost_basis_per_share) * args.shares);

  let tax = 0;
  if (rules.cgt_discount_pct > 0 && args.holding_period_years >= rules.long_term_threshold_years) {
    const taxable = gain * (1 - rules.cgt_discount_pct / 100);
    tax = taxable * rules.ordinary_income_rate;
  } else if (args.holding_period_years >= rules.long_term_threshold_years) {
    tax = gain * rules.long_term_cap_gains_rate;
  } else {
    tax = gain * rules.short_term_cap_gains_rate;
  }
  return {
    gross_proceeds: gross,
    cost_basis_total: args.cost_basis_per_share * args.shares,
    gain,
    tax,
    net_proceeds: gross - tax,
    effective_rate_on_gain: gain > 0 ? tax / gain : 0,
    rules_used: rules.jurisdiction,
  };
}

export type PropertySaleResult = {
  sale_price: number;
  cost_basis: number;
  gain: number;
  taxable_gain: number;
  tax: number;
  mortgage_payoff: number;
  net_to_owner: number;
  rules_used: string;
};

export function propertySaleTax(args: {
  jurisdiction: string;
  sale_price: number;
  cost_basis: number;
  holding_period_years: number;
  mortgage_balance?: number;
  is_primary_residence?: boolean;
  settings?: Settings;
}): PropertySaleResult {
  const rules = getRules(args.jurisdiction, args.settings);
  const gain = Math.max(0, args.sale_price - args.cost_basis);
  let tax = 0;
  let taxable = 0;
  if (args.is_primary_residence && rules.primary_residence_exempt) {
    tax = 0;
    taxable = 0;
  } else if (rules.property_cgt_discount_pct > 0) {
    taxable = gain * (1 - rules.property_cgt_discount_pct / 100);
    tax = taxable * rules.ordinary_income_rate;
  } else {
    taxable = gain;
    tax = gain * rules.property_cgt_rate;
  }
  const net = args.sale_price - tax - (args.mortgage_balance ?? 0);
  return {
    sale_price: args.sale_price,
    cost_basis: args.cost_basis,
    gain,
    taxable_gain: taxable,
    tax,
    mortgage_payoff: args.mortgage_balance ?? 0,
    net_to_owner: net,
    rules_used: rules.jurisdiction,
  };
}

export function yearsBetween(startISO: string | null | undefined, end: Date): number {
  if (!startISO) return 0;
  const start = new Date(startISO + "T00:00:00Z");
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}
