/**
 * Revolver / Executive Lending model.
 *
 * Models J.P. Morgan's Anduril SBLOC-style facility: a revolving line of
 * credit secured by pledged shares. Two interest modes (pay monthly vs
 * capitalise) and a head-to-head Sell-now vs Borrow comparison sharing one
 * monthly engine.
 *
 * Conventions follow the rest of the codebase: Zod-validated schemas as
 * the source of truth, IDs are strings, dates are ISO YYYY-MM-DD strings.
 *
 * NB: the advance rate (max LTV the bank lends against pledged shares) is
 * NOT disclosed in the term sheet — it is a key assumption the user must
 * set. The UI surfaces it prominently.
 */

import { z } from "zod";

import {
  newId,
  releaseKeptShares,
  unvestedSharesAt,
  vestedSharesAt,
  type Scenario,
  type StockHolding,
} from "./models";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const SofrOverrideSchema = z.object({
  id: z.string().default(() => newId()),
  /** Rate becomes effective from this date forward (inclusive). */
  from_date: isoDate,
  /** Annual SOFR % (NOT including the spread). */
  rate_pct: z.number().min(0).max(50),
});
export type SofrOverride = z.infer<typeof SofrOverrideSchema>;

export const RevolverLotSchema = z.object({
  id: z.string().default(() => newId()),
  name: z.string().default(""),
  cost_basis: z.number().nonnegative().default(0),
});
export type RevolverLot = z.infer<typeof RevolverLotSchema>;

/** Additional cash draws taken after the initial draw. Each entry adds to
 *  the balance at the start of the month containing `date`. */
export const DrawEventSchema = z.object({
  id: z.string().default(() => newId()),
  date: isoDate,
  amount: z.number().nonnegative(),
});
export type DrawEvent = z.infer<typeof DrawEventSchema>;

export const RevolverScenarioSchema = z.object({
  id: z.string(),
  name: z.string().default("Revolver scenario"),
  description: z.string().default(""),

  /** Optional link to a StockHolding (Investments tab). When set,
   *  share_price, total_shares_available and the lot list are derived
   *  from the holding live — the manual fields below become defaults
   *  used only when no holding is linked. */
  stock_id: z.string().optional(),
  /** Optional link to a Scenario (Scenarios tab). When set with a
   *  stock_id, annual_appreciation_pct is taken from the scenario's
   *  per-stock override or its default stock growth. */
  scenario_id: z.string().optional(),

  // Shared inputs (used as the manual / fallback values when no
  // stock/scenario is linked)
  draw_amount: z.number().nonnegative().default(2_000_000),
  /** Additional draws taken over the life of the facility. Applied at the
   *  start of the month containing each `date`. */
  draw_schedule: z.array(DrawEventSchema).default([]),
  max_draw: z.number().nonnegative().default(5_000_000),
  start_date: isoDate,
  end_date: isoDate,
  ipo_date: isoDate.optional(),

  /** "monthly": balance flat, interest paid as cash;
   *  "capitalise": interest rolls into balance. */
  interest_mode: z.enum(["monthly", "capitalise"]).default("monthly"),

  sofr_base_pct: z.number().min(0).max(50).default(3.62),
  /** Optional low/high SOFR shocks. When set, the Facility view renders
   *  a shaded band on the balance + cumulative-interest charts spanning
   *  the run-with-low to run-with-high outcomes, with the today line on
   *  top. Both fields stay optional so existing scenarios still parse. */
  sofr_low_pct: z.number().min(0).max(50).optional(),
  sofr_high_pct: z.number().min(0).max(50).optional(),
  sofr_overrides: z.array(SofrOverrideSchema).default([]),
  spread_pct: z.number().min(0).max(20).default(0.5),

  day_count: z.enum(["actual360", "monthly30"]).default("actual360"),

  share_price: z.number().nonnegative().default(68.95),
  annual_appreciation_pct: z.number().default(0),

  /** Max % LTV the bank lends against pledged shares. UNDISCLOSED — set
   *  by the user; default 50%. Surface prominently as an assumption. */
  advance_rate_pct: z.number().min(0).max(100).default(50),
  /** Maintenance LTV threshold for margin-call headroom; default 65%. */
  maintenance_ltv_pct: z.number().min(0).max(100).default(65),
  total_shares_available: z.number().nonnegative().default(214_600),

  // Sell vs Borrow inputs
  lots: z.array(RevolverLotSchema).default([]),
  selected_lot_id: z.string().default(""),
  tax_rate_today_pct: z.number().min(0).max(100).default(37.1),
  tax_rate_future_pct: z.number().min(0).max(100).default(0),
  /** Repayment date for the borrow path. Defaults to ipo_date if set,
   *  else end_date. */
  repayment_date: isoDate.optional(),
  /** Cost basis used to compute future cap-gains at repayment. Defaults
   *  to the selected lot's basis when blank. */
  future_basis: z.number().nonnegative().optional(),
});
export type RevolverScenario = z.infer<typeof RevolverScenarioSchema>;

export function newRevolverScenario(name = "Revolver scenario"): RevolverScenario {
  const todayIso = new Date().toISOString().slice(0, 10);
  const founders: RevolverLot = { id: newId(), name: "Founders", cost_basis: 61.55 };
  const espp: RevolverLot = { id: newId(), name: "ESPP", cost_basis: 40 };
  const recent: RevolverLot = { id: newId(), name: "Recent RSU", cost_basis: 65 };
  return RevolverScenarioSchema.parse({
    id: newId(),
    name,
    start_date: todayIso,
    end_date: "2029-09-30",
    lots: [founders, espp, recent],
    selected_lot_id: founders.id,
  });
}

/** What's actually used by the engine given (optional) links to a stock
 *  holding + a scenario from the main app. Free-form fields on the
 *  revolver scenario remain the source of truth when nothing is linked. */
export type ResolvedRevolverInputs = {
  share_price: number;
  total_shares_available: number;
  annual_appreciation_pct: number;
  lots: RevolverLot[];
  selected_lot_id: string;
  /** Provenance labels surfaced in the UI so the user always sees where
   *  each derived value came from. */
  sources: {
    share_price: string;
    total_shares_available: string;
    annual_appreciation_pct: string;
    lots: string;
  };
};

/** Derive lots from a stock holding: one per release event (basis =
 *  release_price), plus a strike-price lot for Stock Options stocks, plus
 *  an "Outright" lot if shares_owned_outright > 0. Lot ids are stable
 *  (derived from release ids) so persisted selections survive edits. */
function deriveLotsFromStock(stock: StockHolding): RevolverLot[] {
  const lots: RevolverLot[] = [];
  if (stock.shares_owned_outright > 0) {
    lots.push({
      id: `${stock.id}-outright`,
      name: "Outright shares",
      cost_basis: stock.current_share_price,
    });
  }
  if (stock.equity_type === "Stock Options" && (stock.strike_price ?? 0) > 0) {
    lots.push({
      id: `${stock.id}-strike`,
      name: "Options strike",
      cost_basis: stock.strike_price,
    });
  }
  const sortedReleases = [...(stock.releases ?? [])].sort((a, b) =>
    a.release_date.localeCompare(b.release_date),
  );
  for (const r of sortedReleases) {
    const kept = releaseKeptShares(r);
    if (kept <= 0) continue;
    lots.push({
      id: `lot-${r.id}`,
      name: r.name || `Release ${r.release_date}`,
      cost_basis: r.release_price,
    });
  }
  return lots;
}

/** Resolve the live values + lots given optional links. Returns
 *  fallback values from the revolver scenario itself when no holding /
 *  scenario is linked. */
export function resolveRevolverInputs(
  revolver: RevolverScenario,
  stocks: StockHolding[],
  scenarios: Scenario[],
): ResolvedRevolverInputs {
  const stock = revolver.stock_id ? stocks.find((s) => s.id === revolver.stock_id) ?? null : null;
  const scenario = revolver.scenario_id ? scenarios.find((s) => s.id === revolver.scenario_id) ?? null : null;
  const today = new Date();

  // Share price — from the holding's current price (with the scenario's
  // starting-price override applied if both are linked).
  let sharePrice = revolver.share_price;
  let sharePriceSource = "manual";
  if (stock) {
    const overrideStart = scenario?.stock_overrides?.[stock.id]?.starting_share_price;
    sharePrice = overrideStart && overrideStart > 0 ? overrideStart : stock.current_share_price;
    sharePriceSource = overrideStart
      ? `${stock.ticker || stock.company_name} · scenario override`
      : `${stock.ticker || stock.company_name} · current price`;
  }

  // Total shares available — currently-held vested shares (already net
  // of investment releases' withholding and sells) plus any unvested
  // that will arrive over the horizon, so a 5y projection can pledge
  // shares that vest in years 2-5.
  let totalShares = revolver.total_shares_available;
  let totalSharesSource = "manual";
  if (stock) {
    const vestedNow = vestedSharesAt(stock, today);
    const unvestedNow = unvestedSharesAt(stock, today);
    totalShares = Math.max(0, vestedNow + unvestedNow);
    totalSharesSource = `${stock.ticker || stock.company_name} · vested + unvested today`;
  }

  // Annual appreciation — from the scenario's per-stock override if set,
  // else its default stock growth. Target-price override would imply a
  // different rate, but we keep this simple and ignore it (user can
  // still manually edit the field if they unlink the scenario).
  let appreciation = revolver.annual_appreciation_pct;
  let appreciationSource = "manual";
  if (scenario && stock) {
    const ov = scenario.stock_overrides?.[stock.id]?.annual_price_growth_pct;
    appreciation = ov !== undefined ? ov : scenario.default_stock_growth_pct;
    appreciationSource = ov !== undefined
      ? `${scenario.name} · ${stock.ticker || stock.company_name} override`
      : `${scenario.name} · default stock growth`;
  } else if (scenario && !stock) {
    appreciation = scenario.default_stock_growth_pct;
    appreciationSource = `${scenario.name} · default stock growth`;
  }

  // Lots — derived from the stock when linked; manual lots otherwise.
  let lots = revolver.lots;
  let selectedLotId = revolver.selected_lot_id;
  let lotsSource = "manual";
  if (stock) {
    lots = deriveLotsFromStock(stock);
    lotsSource = `${stock.ticker || stock.company_name} · derived from releases`;
    // Remap the selection: keep the user's selected lot if it still
    // exists, otherwise drop to the first derived lot. We persist the
    // user's choice as-is so unlinking restores it cleanly.
    selectedLotId = lots.find((l) => l.id === revolver.selected_lot_id)?.id ?? lots[0]?.id ?? "";
  }

  return {
    share_price: sharePrice,
    total_shares_available: totalShares,
    annual_appreciation_pct: appreciation,
    lots,
    selected_lot_id: selectedLotId,
    sources: {
      share_price: sharePriceSource,
      total_shares_available: totalSharesSource,
      annual_appreciation_pct: appreciationSource,
      lots: lotsSource,
    },
  };
}

/** Apply resolved inputs to produce the effective scenario the engine
 *  runs against. The engine remains pure — it just sees a RevolverScenario
 *  with the right values baked in. */
export function withResolvedInputs(
  revolver: RevolverScenario,
  resolved: ResolvedRevolverInputs,
): RevolverScenario {
  return {
    ...revolver,
    share_price: resolved.share_price,
    total_shares_available: resolved.total_shares_available,
    annual_appreciation_pct: resolved.annual_appreciation_pct,
    lots: resolved.lots,
    selected_lot_id: resolved.selected_lot_id,
  };
}

// ----- date helpers -----

function parseIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function monthStartUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12
    + (to.getUTCMonth() - from.getUTCMonth())
  );
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ----- engine -----

export type FacilityRow = {
  month_index: number;
  date: string;
  balance_start: number;
  interest: number;
  cash_paid: number;
  balance_end: number;
  /** Extra principal drawn this month (from draw_schedule). */
  draw_added: number;
  /** Running total of principal drawn through end of this month. */
  cumulative_drawn: number;
  /** Running total of interest accrued (paid + capitalised) through end
   *  of this month — the borrower's obligation on top of principal. */
  cumulative_interest: number;
  rate_pct: number;
  share_price: number;
  required_collateral_value: number;
  required_shares: number;
  current_ltv_pct: number;
  margin_call_headroom: number;
  flags: { undercollateralised: boolean; ltv_breach: boolean };
};

export type FacilityResult = {
  rows: FacilityRow[];
  mode: "monthly" | "capitalise";
  /** Total interest accrued over the projection (cash + capitalised). */
  total_interest: number;
  /** Cash interest actually paid (mode === "monthly"). */
  total_cash_interest: number;
  ending_balance: number;
  /** Total principal drawn over the horizon (draw_amount + schedule). */
  total_drawn: number;
  peak_required_shares: number;
  ending_ltv_pct: number;
  /** All-in effective annual rate, geometric, from total accrued
   *  interest vs total drawn principal over horizon years. */
  effective_annual_rate_pct: number;
};

/** Effective annual rate at a given month-end based on the active overrides
 *  (each override's `from_date` becomes effective inclusive). Pure base
 *  rate — call sites add the spread. */
function sofrAt(scenario: RevolverScenario, monthEnd: Date): number {
  const overrides = [...(scenario.sofr_overrides ?? [])]
    .filter((o) => Number.isFinite(o.rate_pct))
    .sort((a, b) => a.from_date.localeCompare(b.from_date));
  let rate = scenario.sofr_base_pct;
  for (const ov of overrides) {
    const d = parseIsoDate(ov.from_date);
    if (d <= monthEnd) rate = ov.rate_pct;
  }
  return rate;
}

export function priceAt(scenario: RevolverScenario, asOf: Date): number {
  const start = monthStartUtc(parseIsoDate(scenario.start_date));
  const months = Math.max(0, monthsBetween(start, monthStartUtc(asOf)));
  const annual = scenario.annual_appreciation_pct / 100;
  return scenario.share_price * Math.pow(1 + annual, months / 12);
}

/** Last month index <= cap. The horizon is the earlier of end_date and
 *  ipo_date (if set). */
function projectionEndDate(scenario: RevolverScenario): Date {
  const end = monthStartUtc(parseIsoDate(scenario.end_date));
  const ipo = scenario.ipo_date
    ? monthStartUtc(parseIsoDate(scenario.ipo_date))
    : null;
  if (ipo && ipo < end) return ipo;
  return end;
}

export function computeFacility(
  scenario: RevolverScenario,
  mode: "monthly" | "capitalise",
): FacilityResult {
  const rows: FacilityRow[] = [];
  const start = monthStartUtc(parseIsoDate(scenario.start_date));
  const end = projectionEndDate(scenario);
  const N = Math.max(0, monthsBetween(start, end));
  const pledged = Math.max(1e-9, scenario.total_shares_available);
  const advance = Math.max(1e-9, scenario.advance_rate_pct / 100);
  const maint = scenario.maintenance_ltv_pct / 100;

  // Sort scheduled draws once, and walk them in order alongside months.
  // Draws land at the start of the month containing their date.
  const schedule = [...(scenario.draw_schedule ?? [])]
    .filter((d) => d.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  let drawIdx = 0;

  let balance = scenario.draw_amount;
  let cumulativeDrawn = scenario.draw_amount;
  let totalInterest = 0;
  let totalCashInterest = 0;
  let cumulativeInterest = 0;
  let peakRequiredShares = 0;

  for (let i = 0; i <= N; i++) {
    const monthStart = addMonths(start, i);
    const nextMonthStart = addMonths(start, i + 1);
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
    const days = daysInMonth(monthStart);
    const rate = (sofrAt(scenario, monthEnd) + scenario.spread_pct) / 100;

    // Apply any scheduled draws landing this month (or earlier if the
    // user dated one before start_date). The bump happens before interest
    // so the new principal accrues for the current month.
    let drawAdded = 0;
    while (drawIdx < schedule.length) {
      const d = schedule[drawIdx];
      const dDate = parseIsoDate(d.date);
      if (dDate < nextMonthStart) {
        drawAdded += d.amount;
        drawIdx++;
      } else {
        break;
      }
    }
    balance += drawAdded;
    cumulativeDrawn += drawAdded;

    // Actual / 360 — the SBLOC standard.
    const interest = balance * rate * (days / 360);

    const cashPaid = mode === "monthly" ? interest : 0;
    const balanceStart = balance;
    const balanceEnd = mode === "monthly" ? balance : balance + interest;

    cumulativeInterest += interest;

    const price = priceAt(scenario, monthStart);
    const requiredCollateralValue = balanceEnd / advance;
    const requiredShares = Math.ceil(balanceEnd / (advance * Math.max(1e-9, price)));
    const currentLtv = balanceEnd / (pledged * Math.max(1e-9, price));
    const marginCallHeadroom = maint * pledged * price - balanceEnd;

    rows.push({
      month_index: i,
      date: toIso(monthStart),
      balance_start: balanceStart,
      interest,
      cash_paid: cashPaid,
      balance_end: balanceEnd,
      draw_added: drawAdded,
      cumulative_drawn: cumulativeDrawn,
      cumulative_interest: cumulativeInterest,
      rate_pct: rate * 100,
      share_price: price,
      required_collateral_value: requiredCollateralValue,
      required_shares: requiredShares,
      current_ltv_pct: currentLtv * 100,
      margin_call_headroom: marginCallHeadroom,
      flags: {
        undercollateralised: requiredShares > scenario.total_shares_available,
        ltv_breach: currentLtv >= maint,
      },
    });

    totalInterest += interest;
    totalCashInterest += cashPaid;
    peakRequiredShares = Math.max(peakRequiredShares, requiredShares);
    balance = balanceEnd;
  }

  // Any schedule entries dated past the horizon are dropped from the run
  // but still counted in total_drawn so the caller sees the promised
  // principal (helps flag misconfiguration in the UI).
  let totalDrawn = cumulativeDrawn;
  for (; drawIdx < schedule.length; drawIdx++) {
    totalDrawn += schedule[drawIdx].amount;
  }

  const endingBalance = rows.length > 0 ? rows[rows.length - 1].balance_end : scenario.draw_amount;
  const endingLtv = rows.length > 0 ? rows[rows.length - 1].current_ltv_pct : 0;
  const years = Math.max(1e-9, N / 12);
  const principal = Math.max(1e-9, totalDrawn);
  const effectiveAnnualRate =
    mode === "capitalise"
      ? Math.pow((endingBalance) / principal, 1 / years) - 1
      : (totalInterest / principal) / years;

  return {
    rows,
    mode,
    total_interest: totalInterest,
    total_cash_interest: totalCashInterest,
    ending_balance: endingBalance,
    total_drawn: totalDrawn,
    peak_required_shares: peakRequiredShares,
    ending_ltv_pct: endingLtv,
    effective_annual_rate_pct: effectiveAnnualRate * 100,
  };
}

/** Run computeFacility with the base SOFR shifted to `baseSofr` (overrides
 *  still apply on top by date). Powers the low/high band shading on the
 *  Facility view charts. */
export function computeFacilityAtBaseSofr(
  scenario: RevolverScenario,
  mode: "monthly" | "capitalise",
  baseSofr: number,
): FacilityResult {
  return computeFacility({ ...scenario, sofr_base_pct: baseSofr }, mode);
}

// ----- Sell vs Borrow -----

export type SellPath = {
  path: "sell";
  shares_sold: number;
  tax_paid_now: number;
  remaining_shares: number;
  terminal_net_worth: number;
  notes: string[];
};

export type BorrowPath = {
  path: "borrow_monthly" | "borrow_capitalise";
  total_cash_interest: number;
  ending_balance: number;
  balance_at_repayment: number;
  price_at_repayment: number;
  shares_sold_to_repay: number;
  tax_paid_future: number;
  remaining_shares: number;
  terminal_net_worth: number;
  notes: string[];
};

function selectedLot(scenario: RevolverScenario): RevolverLot | null {
  return scenario.lots.find((l) => l.id === scenario.selected_lot_id) ?? scenario.lots[0] ?? null;
}

/** Solve shares_sold so that net proceeds (post cap-gains tax) equal
 *  `cashNeeded`. Returns `{shares, tax}` and surfaces a degenerate case
 *  if the per-share net is zero (e.g. basis above price, tax confiscatory).
 *  Negative gains aren't taxed — clamp at zero. */
function solveSell(cashNeeded: number, price: number, basis: number, taxPct: number): { shares: number; tax: number } {
  if (cashNeeded <= 0 || price <= 0) return { shares: 0, tax: 0 };
  const gain = Math.max(0, price - basis);
  const t = Math.max(0, Math.min(100, taxPct)) / 100;
  const perShareNet = price - gain * t;
  if (perShareNet <= 1e-9) return { shares: Infinity, tax: Infinity };
  const shares = cashNeeded / perShareNet;
  const tax = shares * gain * t;
  return { shares, tax };
}

function dateForRepayment(scenario: RevolverScenario): Date {
  if (scenario.repayment_date) return monthStartUtc(parseIsoDate(scenario.repayment_date));
  if (scenario.ipo_date) return monthStartUtc(parseIsoDate(scenario.ipo_date));
  return projectionEndDate(scenario);
}

function balanceAt(rows: FacilityRow[], asOf: Date): number {
  if (rows.length === 0) return 0;
  const target = toIso(asOf);
  let chosen = rows[0].balance_end;
  for (const r of rows) {
    if (r.date <= target) chosen = r.balance_end;
    else break;
  }
  return chosen;
}

function totalCashInterestAt(rows: FacilityRow[], asOf: Date): number {
  const target = toIso(asOf);
  let total = 0;
  for (const r of rows) {
    if (r.date > target) break;
    total += r.cash_paid;
  }
  return total;
}

export type SellVsBorrowResult = {
  sell: SellPath;
  borrow_monthly: BorrowPath;
  borrow_capitalise: BorrowPath;
  inputs_snapshot: {
    cash_needed: number;
    price_today: number;
    price_horizon: number;
    price_repayment: number;
    basis_today: number;
    basis_future: number;
    tax_today_pct: number;
    tax_future_pct: number;
    repayment_date: string;
    horizon_date: string;
    months_to_repay: number;
  };
  verdict: {
    /** Positive = borrow wins; negative = sell wins. Highest of the
     *  two borrow modes is compared against the sell path. */
    delta: number;
    leader: "sell" | "borrow_monthly" | "borrow_capitalise";
    explanation: string;
  };
};

export function computeSellVsBorrow(scenario: RevolverScenario): SellVsBorrowResult {
  const lot = selectedLot(scenario);
  const basis = lot?.cost_basis ?? 0;
  const futureBasis = scenario.future_basis !== undefined ? scenario.future_basis : basis;
  const price0 = scenario.share_price;
  const horizon = projectionEndDate(scenario);
  const priceHorizon = priceAt(scenario, horizon);
  const cashNeeded = scenario.draw_amount;

  // --- Sell path ---
  const { shares: sharesSold, tax: taxNow } = solveSell(cashNeeded, price0, basis, scenario.tax_rate_today_pct);
  const remainingAfterSell = Math.max(0, scenario.total_shares_available - sharesSold);
  const terminalSell = remainingAfterSell * priceHorizon;
  const sellNotes: string[] = [];
  if (price0 - basis <= 0) {
    sellNotes.push("Lot basis ≥ current price — no taxable gain; selling raises cash with no tax friction.");
  } else if (scenario.tax_rate_today_pct >= 100) {
    sellNotes.push("Tax rate today is 100% — selling impossible without losing the proceeds.");
  }

  const sellPath: SellPath = {
    path: "sell",
    shares_sold: sharesSold,
    tax_paid_now: taxNow,
    remaining_shares: remainingAfterSell,
    terminal_net_worth: terminalSell,
    notes: sellNotes,
  };

  // --- Borrow paths ---
  const repayDate = dateForRepayment(scenario);
  const priceRepay = priceAt(scenario, repayDate);

  const buildBorrow = (mode: "monthly" | "capitalise"): BorrowPath => {
    const facility = computeFacility(scenario, mode);
    const balanceAtRepay = balanceAt(facility.rows, repayDate);
    const cashInterest = mode === "monthly" ? totalCashInterestAt(facility.rows, repayDate) : 0;
    const { shares: sharesToRepay, tax: taxFuture } = solveSell(
      balanceAtRepay,
      priceRepay,
      futureBasis,
      scenario.tax_rate_future_pct,
    );
    const remaining = Math.max(0, scenario.total_shares_available - sharesToRepay);
    // Carry remaining shares forward to horizon at the price path.
    const terminal = remaining * priceHorizon - cashInterest;
    const notes: string[] = [];
    if (mode === "monthly") {
      notes.push("Pay-monthly interest is real cash leaving the pile — subtracted at horizon to compare apples to apples.");
    }
    if (mode === "capitalise") {
      notes.push("Capitalised interest is inside the balance repaid — already counted via shares_sold_to_repay; no separate cash deduction.");
    }
    if (sharesToRepay > scenario.total_shares_available) {
      notes.push("Borrow path is underwater at repayment — required shares to repay exceed available pledge.");
    }
    return {
      path: mode === "monthly" ? "borrow_monthly" : "borrow_capitalise",
      total_cash_interest: cashInterest,
      ending_balance: facility.ending_balance,
      balance_at_repayment: balanceAtRepay,
      price_at_repayment: priceRepay,
      shares_sold_to_repay: sharesToRepay,
      tax_paid_future: taxFuture,
      remaining_shares: remaining,
      terminal_net_worth: terminal,
      notes,
    };
  };

  const borrowMonthly = buildBorrow("monthly");
  const borrowCapitalise = buildBorrow("capitalise");

  const bestBorrow =
    borrowMonthly.terminal_net_worth >= borrowCapitalise.terminal_net_worth
      ? borrowMonthly
      : borrowCapitalise;
  const delta = bestBorrow.terminal_net_worth - sellPath.terminal_net_worth;
  const leader: SellVsBorrowResult["verdict"]["leader"] =
    delta > 0
      ? bestBorrow.path === "borrow_monthly"
        ? "borrow_monthly"
        : "borrow_capitalise"
      : "sell";

  const taxToday = scenario.tax_rate_today_pct;
  const taxFut = scenario.tax_rate_future_pct;
  let explanation: string;
  if (Math.abs(taxToday - taxFut) < 0.5) {
    explanation =
      "Future tax rate ≈ today's rate, so borrowing just stacks interest on top of an unchanged tax bill — sell wins by ~cumulative interest.";
  } else if (taxFut === 0 && taxToday > 0) {
    explanation =
      "Future tax is 0% (e.g. Cyprus NRA). Borrowing defers the sale until then; the deferred-tax savings have to beat cumulative interest for borrow to win.";
  } else if (taxFut < taxToday) {
    explanation =
      "Future tax rate is lower than today's — borrowing defers the sale into a lower-tax residency; borrow wins iff deferred-tax savings > interest paid.";
  } else {
    explanation =
      "Future tax rate is higher than today's — borrowing both stacks interest AND pushes the sale into a higher-tax window; sell wins clearly.";
  }

  return {
    sell: sellPath,
    borrow_monthly: borrowMonthly,
    borrow_capitalise: borrowCapitalise,
    inputs_snapshot: {
      cash_needed: cashNeeded,
      price_today: price0,
      price_horizon: priceHorizon,
      price_repayment: priceRepay,
      basis_today: basis,
      basis_future: futureBasis,
      tax_today_pct: scenario.tax_rate_today_pct,
      tax_future_pct: scenario.tax_rate_future_pct,
      repayment_date: toIso(repayDate),
      horizon_date: toIso(horizon),
      months_to_repay: Math.max(0, monthsBetween(monthStartUtc(parseIsoDate(scenario.start_date)), repayDate)),
    },
    verdict: { delta, leader, explanation },
  };
}

// ----- Breakeven solvers (bisection) -----

function bisect(
  lo: number,
  hi: number,
  evalDelta: (x: number) => number,
  iterations = 60,
  tolerance = 1,
): number | null {
  let f_lo = evalDelta(lo);
  let f_hi = evalDelta(hi);
  if (!Number.isFinite(f_lo) || !Number.isFinite(f_hi)) return null;
  if (f_lo === 0) return lo;
  if (f_hi === 0) return hi;
  if (f_lo * f_hi > 0) return null;
  let a = lo;
  let b = hi;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    const f_m = evalDelta(m);
    if (Math.abs(f_m) < tolerance) return m;
    if (f_lo * f_m < 0) {
      b = m;
      f_hi = f_m;
    } else {
      a = m;
      f_lo = f_m;
    }
  }
  return (a + b) / 2;
}

/** Solve for tax_rate_future_pct ∈ [0,100] at which the best-borrow
 *  terminal net worth equals the sell terminal net worth. Returns null
 *  if no crossover in range. */
export function solveBreakevenFutureTaxRate(scenario: RevolverScenario): number | null {
  return bisect(0, 100, (rate) => {
    const r = computeSellVsBorrow({ ...scenario, tax_rate_future_pct: rate });
    const bestBorrow = Math.max(
      r.borrow_monthly.terminal_net_worth,
      r.borrow_capitalise.terminal_net_worth,
    );
    return bestBorrow - r.sell.terminal_net_worth;
  });
}

/** Solve for sofr_base_pct ∈ [0,20] at which best-borrow terminal net
 *  worth equals sell terminal net worth, given a 0% future tax rate. */
export function solveBreakevenSofr(scenario: RevolverScenario): number | null {
  const base = { ...scenario, tax_rate_future_pct: 0 };
  return bisect(0, 20, (sofr) => {
    const r = computeSellVsBorrow({ ...base, sofr_base_pct: sofr });
    const bestBorrow = Math.max(
      r.borrow_monthly.terminal_net_worth,
      r.borrow_capitalise.terminal_net_worth,
    );
    return bestBorrow - r.sell.terminal_net_worth;
  });
}

/** Sweep future tax rate from 0 to 37.1 (default today) and report the
 *  terminal net worth of each path at every step. Used for the
 *  comparison chart. */
export function sweepFutureTaxRate(
  scenario: RevolverScenario,
  steps = 21,
): Array<{ tax_pct: number; sell: number; borrow_monthly: number; borrow_capitalise: number }> {
  const max = scenario.tax_rate_today_pct;
  const out: Array<{ tax_pct: number; sell: number; borrow_monthly: number; borrow_capitalise: number }> = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / Math.max(1, steps - 1)) * max;
    const r = computeSellVsBorrow({ ...scenario, tax_rate_future_pct: t });
    out.push({
      tax_pct: t,
      sell: r.sell.terminal_net_worth,
      borrow_monthly: r.borrow_monthly.terminal_net_worth,
      borrow_capitalise: r.borrow_capitalise.terminal_net_worth,
    });
  }
  return out;
}
