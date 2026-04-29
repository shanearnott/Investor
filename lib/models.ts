/**
 * Domain models, ported from the Python prototype.
 * Zod schemas are the source of truth for shape; types are inferred.
 */

import { z } from "zod";

export const SUPPORTED_CURRENCIES = [
  "USD", "AUD", "GBP", "AED", "SGD", "EUR", "CAD", "NZD", "HKD",
] as const;

export const SUPPORTED_JURISDICTIONS = [
  "California",
  "Australia",
  "UAE",
  "UK",
  "Singapore",
  "Canada",
  "Germany",
  "New Zealand",
  "Hong Kong",
  "Ireland",
  "US-Federal-Only",
] as const;

export const EQUITY_TYPES = [
  "Common Stock",
  "RSU",
  "ESPP",
  "Stock Options",
] as const;

export const PROPERTY_COUNTRIES = [
  "United States",
  "Australia",
  "United Kingdom",
  "Singapore",
  "United Arab Emirates",
  "Other",
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().nullable();

export const VestingTrancheSchema = z.object({
  vest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shares: z.number().nonnegative(),
});
export type VestingTranche = z.infer<typeof VestingTrancheSchema>;

export const StockHoldingSchema = z.object({
  id: z.string(),
  ticker: z.string().default(""),
  company_name: z.string().default(""),
  equity_type: z.enum(EQUITY_TYPES),
  currency: z.enum(SUPPORTED_CURRENCIES),
  jurisdiction: z.enum(SUPPORTED_JURISDICTIONS),
  current_share_price: z.number().nonnegative().default(0),
  cost_basis_per_share: z.number().nonnegative().default(0),
  shares_owned_outright: z.number().nonnegative().default(0),
  vesting_schedule: z.array(VestingTrancheSchema).default([]),
  notes: z.string().default(""),
});
export type StockHolding = z.infer<typeof StockHoldingSchema>;

export const PropertySchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  address: z.string().default(""),
  suburb: z.string().default(""),
  region: z.string().default(""),
  country: z.enum(PROPERTY_COUNTRIES).default("United States"),
  postcode: z.string().default(""),
  purchase_price: z.number().nonnegative().default(0),
  purchase_date: isoDate,
  current_value: z.number().nonnegative().default(0),
  annual_growth_pct: z.number().default(4.0),
  mortgage_balance: z.number().nonnegative().default(0),
  currency: z.enum(SUPPORTED_CURRENCIES),
  jurisdiction: z.enum(SUPPORTED_JURISDICTIONS),
  notes: z.string().default(""),
});
export type Property = z.infer<typeof PropertySchema>;

export const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  description: z.string().default(""),
  horizon_years: z.number().int().min(1).max(50).default(5),
  default_stock_growth_pct: z.number().default(8.0),
  default_property_growth_pct: z.number().default(4.0),
  stock_overrides: z.record(z.string(), z.object({
    annual_price_growth_pct: z.number().optional(),
  })).default({}),
  property_overrides: z.record(z.string(), z.object({
    annual_growth_pct: z.number().optional(),
  })).default({}),
  inflation_pct: z.number().default(0),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ProjectItemSchema = z.object({
  name: z.string().default(""),
  cost: z.number().nonnegative().default(0),
  currency: z.enum(SUPPORTED_CURRENCIES),
  notes: z.string().default(""),
});
export type ProjectItem = z.infer<typeof ProjectItemSchema>;

export const FundingSourceSchema = z.object({
  kind: z.enum(["stock", "property", "cash"]),
  asset_id: z.string().nullable().optional(),
  amount_or_shares: z.number().nonnegative().default(0),
});
export type FundingSource = z.infer<typeof FundingSourceSchema>;

export const InvestmentProjectSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  description: z.string().default(""),
  target_date: isoDate,
  currency: z.enum(SUPPORTED_CURRENCIES),
  /** Tax jurisdiction the project is executed in. All liquidations funding
   *  this project are taxed under this jurisdiction's rules, not the
   *  underlying asset's. */
  jurisdiction: z.enum(SUPPORTED_JURISDICTIONS).default("California"),
  items: z.array(ProjectItemSchema).default([]),
  funding: z.array(FundingSourceSchema).default([]),
  scenario_id: z.string().nullable().optional(),
});
export type InvestmentProject = z.infer<typeof InvestmentProjectSchema>;

export const SettingsSchema = z.object({
  primary_currency: z.enum(SUPPORTED_CURRENCIES).default("USD"),
  secondary_currency: z.enum(SUPPORTED_CURRENCIES).default("AUD"),
  fx_rates: z.record(z.string(), z.number()).default({
    USD: 1.0, AUD: 1.52, GBP: 0.78, AED: 3.67, SGD: 1.34,
    EUR: 0.92, CAD: 1.36, NZD: 1.65, HKD: 7.82,
  }),
  default_jurisdiction: z.enum(SUPPORTED_JURISDICTIONS).default("California"),
  tax_overrides: z.record(z.string(), z.record(z.string(), z.union([z.number(), z.boolean()]))).default({}),
  /** Google OAuth Web Client ID. If set, the Settings page exposes Drive
   *  sync controls. Stored in Settings so it persists across reloads. */
  google_oauth_client_id: z.string().default(""),
});
export type Settings = z.infer<typeof SettingsSchema>;

// ID helper
export function newId(): string {
  // 12 hex chars
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

// Date helpers
export function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Stock helpers
export function totalGrantedShares(h: StockHolding): number {
  return h.shares_owned_outright + h.vesting_schedule.reduce((s, t) => s + t.shares, 0);
}

export function vestedSharesAt(h: StockHolding, asOf: Date): number {
  let v = h.shares_owned_outright;
  for (const t of h.vesting_schedule) {
    const d = parseISO(t.vest_date);
    if (d && d <= asOf) v += t.shares;
  }
  return v;
}

export function propertyEquity(p: Property): number {
  return p.current_value - p.mortgage_balance;
}

// All collections, used for storage IO and demo data
export type CollectionsMap = {
  stocks: StockHolding[];
  properties: Property[];
  scenarios: Scenario[];
  projects: InvestmentProject[];
  settings: Settings;
};

export const COLLECTION_FILES: Record<keyof CollectionsMap, string> = {
  stocks: "stocks.json",
  properties: "properties.json",
  scenarios: "scenarios.json",
  projects: "projects.json",
  settings: "settings.json",
};
