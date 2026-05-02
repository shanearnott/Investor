/**
 * Investment-project capital-adequacy + tax engine.
 *
 * The user lists assets they'd be willing to use as funding (in priority
 * order). The engine walks the list, working out the smallest amount of
 * each asset needed to cover the project's net-of-tax cost. If the list
 * is exhausted with cost remaining, that's the shortfall.
 */

import { convert } from "./fx";
import {
  parseISO,
  vestedSharesAt,
  type InvestmentProject,
  type Property,
  type Scenario,
  type Settings,
  type StockHolding,
} from "./models";
import { projectPropertyValueAt, projectStockValueAt } from "./projections";
import { propertySaleTax, stockSaleTax, yearsBetween } from "./tax";

export type FundingLineResult = {
  kind: "stock" | "property" | "cash";
  asset_label: string;
  gross_proceeds: number;
  tax: number;
  net_proceeds: number;
  detail: Record<string, unknown>;
};

export type ProjectEvaluation = {
  project_id: string;
  project_name: string;
  scenario_id: string;
  scenario_name: string;
  target_date: string | null | undefined;
  primary_currency: string;
  total_cost: number;
  funding_lines: FundingLineResult[];
  total_gross: number;
  total_tax: number;
  /** Net proceeds actually drawn down to cover the project (≈ total_cost when funded). */
  total_net_funding: number;
  /** Full post-tax capacity of every listed source whether drawn or not. */
  total_available_net: number;
  /** total_available_net − total_cost. Positive = surplus capacity left over after the project. */
  surplus_or_shortfall: number;
  is_funded: boolean;
};

function resolveTargetDate(p: InvestmentProject): Date {
  if (p.target_date) {
    const d = parseISO(p.target_date);
    if (d) return d;
  }
  return new Date();
}

const fmt0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function evaluateProject(args: {
  project: InvestmentProject;
  scenario: Scenario;
  holdings: StockHolding[];
  properties: Property[];
  settings: Settings;
}): ProjectEvaluation {
  const { project, scenario, holdings, properties, settings } = args;
  const target = resolveTargetDate(project);
  const primary = settings.primary_currency;

  // Total cost in primary currency
  let totalCost = 0;
  for (const item of project.items) {
    totalCost += convert(item.cost, item.currency, primary, settings);
  }

  const holdingsById = new Map(holdings.map((h) => [h.id, h]));
  const propsById = new Map(properties.map((p) => [p.id, p]));

  const lines: FundingLineResult[] = [];
  // How much net-of-tax funding we still need. Counts down as each source
  // contributes; once it hits 0, later sources emit zero-use lines.
  let remaining = totalCost;
  // Sum of every listed source's full post-tax capacity, whether drawn or
  // not — drives the headline surplus figure.
  let totalAvailableNet = 0;

  for (const fs of project.funding) {
    if (fs.kind === "cash") {
      // Cash is the only kind where the user must say *how much* they
      // have — it's not derivable from any tracked asset.
      const cashAvail = Math.max(0, fs.amount_or_shares);
      const use = remaining > 0 ? Math.min(remaining, cashAvail) : 0;
      totalAvailableNet += cashAvail;
      lines.push({
        kind: "cash",
        asset_label: `Cash · ${fmt0.format(cashAvail)} ${primary} available`,
        gross_proceeds: use,
        tax: 0,
        net_proceeds: use,
        detail: {
          cash_available: cashAvail,
          cash_used: use,
          cash_remaining: cashAvail - use,
          fully_used: cashAvail > 0 && use >= cashAvail,
          note: use === 0 && remaining <= 0 ? "Not needed — project already funded." : undefined,
        },
      });
      remaining -= use;
      continue;
    }

    if (fs.kind === "stock") {
      const h = holdingsById.get(fs.asset_id || "");
      if (!h) {
        lines.push({
          kind: "stock",
          asset_label: "(missing)",
          gross_proceeds: 0,
          tax: 0,
          net_proceeds: 0,
          detail: { error: `Holding ${fs.asset_id} not found` },
        });
        continue;
      }

      const v = projectStockValueAt(h, scenario, target, primary, settings);
      const projectedNative = v.projected_price;
      const liquidAvail = vestedSharesAt(h, target);
      const costBasis = h.cost_basis_per_share > 0 ? h.cost_basis_per_share : h.current_share_price;
      const holdingPeriod = Math.max(
        0,
        (target.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 365.25),
      );

      if (liquidAvail <= 0 || projectedNative <= 0) {
        lines.push({
          kind: "stock",
          asset_label: `${h.ticker || h.company_name}`,
          gross_proceeds: 0,
          tax: 0,
          net_proceeds: 0,
          detail: {
            note: liquidAvail <= 0 ? "No liquid shares at target date." : "Projected price ≤ 0.",
            shares_available: liquidAvail,
            projected_price_native: projectedNative,
          },
        });
        continue;
      }

      // For RSUs, apply the scenario's RSU income-tax dropdown as the all-in
      // haircut (matches the projections chart's net-of-tax line). Non-RSU
      // equity goes through the full CGT engine.
      const isRsu = h.equity_type === "RSU";
      const rsuRate = Math.max(0, Math.min(100, scenario.rsu_tax_rate_pct ?? 0)) / 100;

      // Run the tax calc once for the full liquid pool — proceeds and tax
      // are both linear in shares, so net-per-share derived from the full
      // pool is exact for any sub-quantity.
      let txFull = stockSaleTax({
        jurisdiction: project.jurisdiction,
        sale_price_per_share: projectedNative,
        cost_basis_per_share: costBasis,
        shares: liquidAvail,
        holding_period_years: holdingPeriod,
        settings,
      });
      if (isRsu) {
        const grossFull = projectedNative * liquidAvail;
        const taxFull = grossFull * rsuRate;
        txFull = { ...txFull, gross_proceeds: grossFull, tax: taxFull, net_proceeds: grossFull - taxFull };
      }
      const netFullPrimary = convert(txFull.net_proceeds, h.currency, primary, settings);
      totalAvailableNet += netFullPrimary;
      const netPerShare = netFullPrimary / liquidAvail;

      let sharesNeeded = 0;
      if (remaining > 0 && netPerShare > 0) {
        sharesNeeded = Math.min(liquidAvail, Math.ceil(remaining / netPerShare));
      }

      let tx = stockSaleTax({
        jurisdiction: project.jurisdiction,
        sale_price_per_share: projectedNative,
        cost_basis_per_share: costBasis,
        shares: sharesNeeded,
        holding_period_years: holdingPeriod,
        settings,
      });
      if (isRsu) {
        const grossN = projectedNative * sharesNeeded;
        const taxN = grossN * rsuRate;
        tx = { ...tx, gross_proceeds: grossN, tax: taxN, net_proceeds: grossN - taxN };
      }

      const gross_p = convert(tx.gross_proceeds, h.currency, primary, settings);
      const tax_p = convert(tx.tax, h.currency, primary, settings);
      const net_p = convert(tx.net_proceeds, h.currency, primary, settings);

      const label = sharesNeeded > 0
        ? `${h.ticker || h.company_name} — ${fmt0.format(sharesNeeded)} sh @ ~${fmt2.format(projectedNative)} ${h.currency}`
        : `${h.ticker || h.company_name} — not needed`;

      const detail: Record<string, unknown> = { ...tx };
      detail.projected_price_native = projectedNative;
      detail.shares_available = liquidAvail;
      detail.shares_used = sharesNeeded;
      detail.shares_remaining = liquidAvail - sharesNeeded;
      detail.fully_used = sharesNeeded >= liquidAvail;
      if (isRsu) {
        detail.tax_model = `RSU income tax @ ${(rsuRate * 100).toFixed(0)}% (scenario)`;
      }
      if (remaining > 0 && netPerShare > 0 && sharesNeeded === liquidAvail) {
        detail.warning = `Required all ${fmt0.format(liquidAvail)} liquid shares — still need more funding.`;
      }
      if (remaining <= 0) detail.note = "Not needed — project already funded.";

      lines.push({
        kind: "stock",
        asset_label: label,
        gross_proceeds: gross_p,
        tax: tax_p,
        net_proceeds: net_p,
        detail,
      });
      remaining -= net_p;
      continue;
    }

    if (fs.kind === "property") {
      const p = propsById.get(fs.asset_id || "");
      if (!p) {
        lines.push({
          kind: "property",
          asset_label: "(missing)",
          gross_proceeds: 0,
          tax: 0,
          net_proceeds: 0,
          detail: { error: `Property ${fs.asset_id} not found` },
        });
        continue;
      }

      const vNative = projectPropertyValueAt(p, scenario, target, p.currency, settings);
      const holdingPeriod = yearsBetween(p.purchase_date, target);

      // Net-to-owner scales linearly with fraction sold (sale price, cost
      // basis, and mortgage payoff all scale; the rate is flat). Compute
      // for fully-sold then derive fraction needed.
      const txFull = propertySaleTax({
        jurisdiction: project.jurisdiction,
        sale_price: vNative.gross,
        cost_basis: p.purchase_price,
        holding_period_years: holdingPeriod,
        mortgage_balance: p.mortgage_balance,
        is_primary_residence: false,
        settings,
      });
      const netFullPrimary = convert(txFull.net_to_owner, p.currency, primary, settings);
      totalAvailableNet += Math.max(0, netFullPrimary);

      if (netFullPrimary <= 0) {
        lines.push({
          kind: "property",
          asset_label: `${p.name}`,
          gross_proceeds: 0,
          tax: 0,
          net_proceeds: 0,
          detail: {
            note: "No equity at target date (mortgage ≥ projected value, or sale yields nothing after tax).",
            projected_value_native: vNative.gross,
          },
        });
        continue;
      }

      let fraction = 0;
      if (remaining > 0) {
        fraction = Math.min(1, remaining / netFullPrimary);
      }

      const salePriceNative = vNative.gross * fraction;
      const costBasisNative = p.purchase_price * fraction;
      const mortgageNative = p.mortgage_balance * fraction;

      const tx = propertySaleTax({
        jurisdiction: project.jurisdiction,
        sale_price: salePriceNative,
        cost_basis: costBasisNative,
        holding_period_years: holdingPeriod,
        mortgage_balance: mortgageNative,
        is_primary_residence: false,
        settings,
      });

      const gross_p = convert(tx.sale_price, p.currency, primary, settings);
      const tax_p = convert(tx.tax, p.currency, primary, settings);
      const net_p = convert(tx.net_to_owner, p.currency, primary, settings);

      const pctSold = fraction * 100;
      const label = fraction > 0
        ? `${p.name} — sell ${pctSold.toFixed(1)}% @ ~${fmt0.format(salePriceNative)} ${p.currency}`
        : `${p.name} — not needed`;

      const detail: Record<string, unknown> = {
        ...tx,
        fraction_used: fraction,
        fraction_remaining: 1 - fraction,
        fully_used: fraction >= 1,
        holding_period_years: Number(holdingPeriod.toFixed(2)),
      };
      if (remaining > 0 && fraction === 1) {
        detail.warning = `Fully selling property only yields ${fmt0.format(netFullPrimary)} ${primary} — still need more funding.`;
      }
      if (remaining <= 0) detail.note = "Not needed — project already funded.";

      lines.push({
        kind: "property",
        asset_label: label,
        gross_proceeds: gross_p,
        tax: tax_p,
        net_proceeds: net_p,
        detail,
      });
      remaining -= net_p;
      continue;
    }
  }

  const totalGross = lines.reduce((s, l) => s + l.gross_proceeds, 0);
  const totalTax = lines.reduce((s, l) => s + l.tax, 0);
  const totalNet = lines.reduce((s, l) => s + l.net_proceeds, 0);

  return {
    project_id: project.id,
    project_name: project.name,
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    target_date: project.target_date,
    primary_currency: primary,
    total_cost: totalCost,
    funding_lines: lines,
    total_gross: totalGross,
    total_tax: totalTax,
    total_net_funding: totalNet,
    total_available_net: totalAvailableNet,
    // Surplus reflects the leftover capacity from EVERY listed source
    // (whether drawn down or not), so the user can see how much of their
    // available pool remains after the project.
    surplus_or_shortfall: totalAvailableNet - totalCost,
    // Allow a tiny rounding tolerance — sharesNeeded uses Math.ceil, so
    // we can be a fraction of a share over the cost.
    is_funded: totalAvailableNet >= totalCost - 0.01,
  };
}
