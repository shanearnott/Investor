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

/** A single vest event — one date, one share count. */
export const VestEventSchema = z.object({
  vest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shares: z.number().nonnegative(),
});
export type VestEvent = z.infer<typeof VestEventSchema>;

/** A tranche / grant — a logical group of vest events (e.g. "2024 hire grant",
 *  "2025 refresher"). A stock can have multiple tranches; each has its own
 *  schedule of vest events. */
export const TrancheSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  grant_date: isoDate,
  vest_events: z.array(VestEventSchema).default([]),
  notes: z.string().default(""),
});
export type Tranche = z.infer<typeof TrancheSchema>;

/** A combined release + (optional) sale event on a holding.
 *
 *  Release portion (always present): the date a batch of shares came
 *  off vesting, the gross share count, the per-share fair-market value
 *  at release (the cost basis for any later sale), and the income-tax
 *  withholding — either an explicit sell-to-cover share count or an
 *  equivalent percentage rate. The post-withholding shares are kept
 *  by the user.
 *
 *  Sale portion (optional): if the user has also sold those shares,
 *  fill in the sell date, sell price, and cap-gains tax rate. When a
 *  sale is present the *kept* shares from the release leave the
 *  holding on the sell date. */
export const StockHoldingSaleSchema = z.object({
  id: z.string(),
  // Release piece — always required.
  release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shares: z.number().nonnegative().default(0),
  release_price: z.number().nonnegative().default(0),
  /** Number of shares the broker auto-sold to cover income tax at the
   *  release. Takes precedence over `tax_rate_pct` when > 0. */
  sell_to_cover_shares: z.number().nonnegative().default(0),
  /** Income-tax rate, % of release shares. Used when sell-to-cover is 0.
   *  shares × rate% are subtracted from the kept count. */
  tax_rate_pct: z.number().min(0).max(100).default(0),
  // Sale piece — optional.
  sell_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Per-share sale price in the holding's native currency. Blank = use
   *  the holding's `current_share_price`. */
  sale_price: z.number().nonnegative().optional(),
  /** Capital-gains tax rate applied to the gain (sale_price − release_price)
   *  on the kept shares. Defaults via `defaultSaleTaxRate(jurisdiction)`. */
  sale_tax_rate_pct: z.number().min(0).max(100).default(0),
  notes: z.string().default(""),
});
export type StockHoldingSale = z.infer<typeof StockHoldingSaleSchema>;

/** Shares lost at release to either explicit sell-to-cover or an
 *  equivalent tax rate. Capped at the gross release shares. */
export function eventWithholdingShares(s: StockHoldingSale): number {
  const cover = Math.min(s.sell_to_cover_shares ?? 0, s.shares);
  if (cover > 0) return cover;
  const rate = Math.min(100, Math.max(0, s.tax_rate_pct ?? 0));
  return Math.min(s.shares, (s.shares * rate) / 100);
}

/** Net shares the user keeps from a release (after withholding). */
export function eventNetReleaseShares(s: StockHoldingSale): number {
  return Math.max(0, s.shares - eventWithholdingShares(s));
}

/** Approximate default capital-gains rate by jurisdiction. Used to
 *  pre-populate new sale events; the user can override. */
export function defaultSaleTaxRate(jurisdiction: string): number {
  switch (jurisdiction) {
    case "California": return 25;       // approx US LTCG 15-20 + CA state 10
    case "Federal Only": return 15;     // US LTCG
    case "Australia": return 22.5;      // 45% marginal × 50% CGT discount
    case "United Kingdom": return 20;   // higher-band CGT
    case "Canada": return 25;           // approx, with 50% inclusion
    default: return 20;
  }
}

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
  /** Multiple tranches per stock; each has its own vesting schedule. */
  tranches: z.array(TrancheSchema).default([]),
  /** Recorded sales — shares actually sold (or committed to be sold) out
   *  of this holding. */
  sales: z.array(StockHoldingSaleSchema).default([]),
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
  /** Per-stock overrides.
   *  - `starting_share_price`: pretend today's price is this value for the
   *    scenario. Affects today's projected value AND becomes the base from
   *    which future growth is computed. Useful for "what if the next funding
   *    round prices me at $X right now" what-ifs.
   *  - `annual_price_growth_pct`: overrides the scenario default growth.
   *  - `target_share_price`: at the scenario's horizon. The engine derives
   *    the implied annual growth rate from the (possibly overridden) starting
   *    price up to this target. Wins over annual_price_growth_pct if set. */
  stock_overrides: z.record(z.string(), z.object({
    starting_share_price: z.number().nonnegative().optional(),
    annual_price_growth_pct: z.number().optional(),
    target_share_price: z.number().nonnegative().optional(),
  })).default({}),
  property_overrides: z.record(z.string(), z.object({
    annual_growth_pct: z.number().optional(),
  })).default({}),
  inflation_pct: z.number().default(0),
  /** Scenario-wide tax jurisdiction for RSUs. Models "what if I'm taxed
   *  here when these vest" — overrides each RSU holding's own jurisdiction
   *  for the purposes of this scenario. Non-RSU equity is unaffected. */
  rsu_tax_jurisdiction: z.enum(SUPPORTED_JURISDICTIONS).default("California"),
  /** Income-tax % applied to RSU value (vested + unvested) in this scenario.
   *  Pre-fills from a per-jurisdiction default when the dropdown changes,
   *  but stays user-editable so individual circumstances can override. */
  rsu_tax_rate_pct: z.number().min(0).max(100).default(50),
  /** Optional per-calendar-year RSU tax overrides, keyed by 4-digit year
   *  string ("2028" -> 0). Shares that vest in an overridden year are taxed
   *  at that year's rate instead of the flat rsu_tax_rate_pct — models
   *  "I relocate, so RSUs vesting from 2028 are taxed in the new place".
   *  Empty = pure flat-rate behaviour (unchanged). */
  rsu_tax_year_overrides: z.record(z.string(), z.number().min(0).max(100)).default({}),
  /** Planned stock sales within the scenario.
   *  - release_date: when the shares leave the holding's equity projection
   *    (they stop growing with the stock).
   *  - sell_date (optional): when post-tax cash is added to net worth.
   *    Defaults to release_date. Between release and sell the gross value is
   *    held as a flat "pending" amount so net worth stays continuous.
   *  - sale_price (optional): per-share price in the stock's native currency
   *    to use for proceeds. If unset, the projected price at sell_date.
   *  - `date` is the legacy single-date field, still read as a fallback for
   *    both release_date and sell_date.
   *  Shares are capped at those vested by release_date and not already
   *  earmarked by an earlier sale. Multiple sales over time are allowed. */
  stock_sales: z.array(z.object({
    id: z.string(),
    stock_id: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sell_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sale_price: z.number().nonnegative().optional(),
    shares: z.number().nonnegative().default(0),
    tax_rate_pct: z.number().min(0).max(100).default(0),
  })).default([]),
});
export type StockSale = z.infer<typeof ScenarioSchema>["stock_sales"][number];

/** Typical top-marginal-on-RSU defaults used to pre-fill the rate input
 *  when the user picks a new jurisdiction in a scenario. Editable after. */
export const RSU_DEFAULT_TAX_RATES: Partial<Record<typeof SUPPORTED_JURISDICTIONS[number], number>> = {
  "California": 50,
  "US-Federal-Only": 37,
  "Australia": 51,
  "UAE": 0,
};
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

/** Has this event's sale piece settled by `asOf`? */
function eventSold(s: StockHoldingSale, asOf: Date): boolean {
  if (!s.sell_date) return false;
  const d = parseISO(s.sell_date);
  return !!d && d <= asOf;
}

/** Has this event's release piece happened by `asOf`? */
function eventReleased(s: StockHoldingSale, asOf: Date): boolean {
  const d = parseISO(s.release_date);
  return !!d && d <= asOf;
}

/** Set of release dates the user has logged explicit events for. Any
 *  tranche vest_event whose date matches one of these is treated as
 *  "already represented" by the explicit event — we don't double-count
 *  it in share totals. */
function explicitReleaseDates(h: StockHolding): Set<string> {
  const out = new Set<string>();
  for (const s of h.sales ?? []) out.add(s.release_date);
  return out;
}

/** Total shares the holding currently holds — outright base + planned
 *  vests from tranches (suppressing any that an explicit event covers)
 *  + net release shares the user has kept on explicit events.
 *  Independent of asOf. */
export function totalGrantedShares(h: StockHolding): number {
  const dropDates = explicitReleaseDates(h);
  let total = h.shares_owned_outright;
  for (const t of h.tranches) {
    for (const ev of t.vest_events) {
      if (dropDates.has(ev.vest_date)) continue;
      total += ev.shares;
    }
  }
  for (const s of h.sales ?? []) {
    if (s.sell_date) continue; // released-and-sold contributes nothing to held total
    total += eventNetReleaseShares(s);
  }
  return Math.max(0, total);
}

/** Vested-or-outright shares as of `asOf`. Sums:
 *   - outright base
 *   - tranche vest_events whose date has passed AND aren't shadowed by
 *     a matching explicit release event (otherwise the explicit event
 *     is the source of truth)
 *   - net release shares from explicit events that have released and
 *     have NOT settled a sale (the user still holds them)
 *  Shares from sold events are excluded entirely once the sale settles. */
export function vestedSharesAt(h: StockHolding, asOf: Date): number {
  const dropDates = explicitReleaseDates(h);
  let v = h.shares_owned_outright;
  for (const t of h.tranches) {
    for (const ev of t.vest_events) {
      if (dropDates.has(ev.vest_date)) continue;
      const d = parseISO(ev.vest_date);
      if (d && d <= asOf) v += ev.shares;
    }
  }
  for (const s of h.sales ?? []) {
    if (!eventReleased(s, asOf)) continue;
    if (eventSold(s, asOf)) continue;
    v += eventNetReleaseShares(s);
  }
  return Math.max(0, v);
}

/** Total shares sold out via explicit events whose sale has settled by `asOf`. */
export function totalSoldShares(h: StockHolding, asOf: Date): number {
  let n = 0;
  for (const s of h.sales ?? []) {
    if (eventSold(s, asOf)) n += eventNetReleaseShares(s);
  }
  return n;
}

/** Native-currency math for the sale piece of a release event. The cost
 *  basis is the release_price (per share); the cap-gains tax is on
 *  (sale_price − release_price) × kept shares. */
export function saleEventMath(s: StockHoldingSale, h: StockHolding): {
  price: number; sharesSold: number; gross: number; basis: number; cost: number; gain: number; tax: number; net: number;
} {
  const price = s.sale_price !== undefined && s.sale_price > 0 ? s.sale_price : h.current_share_price;
  const basis = s.release_price && s.release_price > 0 ? s.release_price : h.cost_basis_per_share;
  const sharesSold = eventNetReleaseShares(s);
  const gross = sharesSold * price;
  const cost = sharesSold * basis;
  const gain = Math.max(0, gross - cost);
  const tax = gain * (Math.min(100, Math.max(0, s.sale_tax_rate_pct ?? 0)) / 100);
  const net = gross - tax;
  return { price, sharesSold, gross, basis, cost, gain, tax, net };
}

/** Native-currency math for the release piece of an event. */
export function releaseEventMath(s: StockHoldingSale, h: StockHolding): {
  price: number; gross: number; withheldShares: number; withheldValue: number; kept: number;
} {
  const price = s.release_price && s.release_price > 0 ? s.release_price : h.cost_basis_per_share;
  const gross = s.shares * price;
  const withheldShares = eventWithholdingShares(s);
  const withheldValue = withheldShares * price;
  const kept = eventNetReleaseShares(s);
  return { price, gross, withheldShares, withheldValue, kept };
}

/** Flatten all vest events across all tranches into a single list with the
 *  parent tranche name/id attached. Useful for dashboards that want a single
 *  per-stock event stream. Sorted by date ascending. */
export function flatVestEvents(h: StockHolding): Array<VestEvent & { tranche_id: string; tranche_name: string }> {
  const out: Array<VestEvent & { tranche_id: string; tranche_name: string }> = [];
  for (const t of h.tranches) {
    for (const ev of t.vest_events) {
      out.push({ ...ev, tranche_id: t.id, tranche_name: t.name });
    }
  }
  out.sort((a, b) => a.vest_date.localeCompare(b.vest_date));
  return out;
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
