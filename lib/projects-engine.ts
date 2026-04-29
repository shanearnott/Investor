/**
 * Investment-project capital-adequacy + tax engine.
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
  total_net_funding: number;
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

  for (const fs of project.funding) {
    if (fs.kind === "cash") {
      const net = fs.amount_or_shares;
      lines.push({
        kind: "cash",
        asset_label: "Cash",
        gross_proceeds: net,
        tax: 0,
        net_proceeds: net,
        detail: { note: "Cash contribution (assumed in primary currency)." },
      });
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
      const sharesRequested = fs.amount_or_shares;

      const v = projectStockValueAt(h, scenario, target, primary, settings);
      const projectedNative = v.projected_price;

      // Vested shares ARE liquid — no separate trigger logic anymore.
      const vested = vestedSharesAt(h, target);
      const liquidAvail = vested;
      const sharesActually = Math.min(sharesRequested, liquidAvail);

      const costBasis = h.cost_basis_per_share > 0 ? h.cost_basis_per_share : h.current_share_price;
      const holdingPeriod = Math.max(0, (target.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 365.25));

      // Tax follows the PROJECT's jurisdiction, not the holding's — the project
      // is the entity being executed in a particular country.
      const tx = stockSaleTax({
        jurisdiction: project.jurisdiction,
        sale_price_per_share: projectedNative,
        cost_basis_per_share: costBasis,
        shares: sharesActually,
        holding_period_years: holdingPeriod,
        settings,
      });

      const gross_p = convert(tx.gross_proceeds, h.currency, primary, settings);
      const tax_p = convert(tx.tax, h.currency, primary, settings);
      const net_p = convert(tx.net_proceeds, h.currency, primary, settings);

      const label = `${h.ticker || h.company_name} — ${sharesActually.toFixed(0)} sh @ ~${projectedNative.toFixed(2)} ${h.currency}`;
      const detail: Record<string, unknown> = { ...tx };
      detail.projected_price_native = projectedNative;
      detail.liquid_shares_available = liquidAvail;
      detail.shares_requested = sharesRequested;
      detail.shares_sold = sharesActually;
      if (sharesActually < sharesRequested) {
        detail.warning = `Only ${liquidAvail.toFixed(0)} shares liquid at ${target.toISOString().slice(0,10)}; capped from ${sharesRequested}.`;
      }

      lines.push({
        kind: "stock",
        asset_label: label,
        gross_proceeds: gross_p,
        tax: tax_p,
        net_proceeds: net_p,
        detail,
      });
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
      const fraction = Math.max(0, Math.min(1, fs.amount_or_shares));
      const vNative = projectPropertyValueAt(p, scenario, target, p.currency, settings);
      const salePriceNative = vNative.gross * fraction;
      const costBasisNative = p.purchase_price * fraction;
      const holdingPeriod = yearsBetween(p.purchase_date, target);
      const mortgageNative = p.mortgage_balance * fraction;

      const tx = propertySaleTax({
        // Project's jurisdiction (not the property's) — same reasoning as
        // for stocks: tax is owed where the funding event happens.
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

      const label = `${p.name} — sell ${(fraction * 100).toFixed(0)}% @ ~${salePriceNative.toFixed(0)} ${p.currency}`;
      const detail: Record<string, unknown> = { ...tx, fraction_sold: fraction, holding_period_years: Number(holdingPeriod.toFixed(2)) };
      lines.push({
        kind: "property",
        asset_label: label,
        gross_proceeds: gross_p,
        tax: tax_p,
        net_proceeds: net_p,
        detail,
      });
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
    surplus_or_shortfall: totalNet - totalCost,
    is_funded: totalNet - totalCost >= 0,
  };
}
