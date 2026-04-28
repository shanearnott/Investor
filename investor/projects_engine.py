"""Investment project evaluation.

Given a project (list of cost items + funding sources) and a scenario,
compute whether the chosen funding (at the project's target date in that
scenario) is sufficient to cover the cost — accounting for tax on the
liquidations.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

from .fx import convert
from .growth import GrowthRateService
from .models import (
    FundingSource,
    InvestmentProject,
    Property,
    Scenario,
    Settings,
    StockHolding,
)
from .projections import project_property_value_at, project_stock_value_at
from .tax import property_sale_tax, stock_sale_tax, years_between


@dataclass
class FundingLineResult:
    kind: str
    asset_label: str
    gross_proceeds: float
    tax: float
    net_proceeds: float
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProjectEvaluation:
    project_id: str
    project_name: str
    scenario_id: Optional[str]
    scenario_name: Optional[str]
    target_date: Optional[str]
    primary_currency: str
    total_cost: float
    funding_lines: list[FundingLineResult] = field(default_factory=list)
    total_gross: float = 0.0
    total_tax: float = 0.0
    total_net_funding: float = 0.0
    surplus_or_shortfall: float = 0.0  # positive = surplus, negative = shortfall

    @property
    def is_funded(self) -> bool:
        return self.surplus_or_shortfall >= 0


def _resolve_target_date(project: InvestmentProject) -> date:
    if project.target_date:
        try:
            return date.fromisoformat(project.target_date)
        except ValueError:
            pass
    return date.today()


def evaluate_project(
    *,
    project: InvestmentProject,
    scenario: Scenario,
    holdings: list[StockHolding],
    properties: list[Property],
    settings: Settings,
    growth_service: Optional[GrowthRateService] = None,
) -> ProjectEvaluation:
    target = _resolve_target_date(project)
    primary_ccy = settings.primary_currency

    # Project total cost in primary currency (items may be in other currencies)
    total_cost = 0.0
    for item in project.items:
        total_cost += convert(item.cost, item.currency, primary_ccy, settings)
    # If the project's currency differs from primary, the "label" still uses project.currency
    # but math is done in primary.

    holdings_by_id = {h.id: h for h in holdings}
    properties_by_id = {p.id: p for p in properties}

    lines: list[FundingLineResult] = []

    for fs in project.funding:
        if fs.kind == "cash":
            net = float(fs.amount_or_shares)
            lines.append(
                FundingLineResult(
                    kind="cash",
                    asset_label="Cash",
                    gross_proceeds=net,
                    tax=0.0,
                    net_proceeds=net,
                    detail={"note": "Cash contribution (assumed in primary currency)."},
                )
            )
            continue

        if fs.kind == "stock":
            h = holdings_by_id.get(fs.asset_id or "")
            if not h:
                lines.append(FundingLineResult(kind="stock", asset_label="(missing)", gross_proceeds=0, tax=0, net_proceeds=0,
                                               detail={"error": f"Holding {fs.asset_id} not found"}))
                continue
            shares_to_sell = float(fs.amount_or_shares)

            # Get projected price at target date
            v = project_stock_value_at(h, scenario, target, primary_ccy, settings)
            projected_price_native = v["projected_price"]  # in holding's currency

            # Liquidity check: only liquid shares can actually be sold
            vested = h.vested_shares_at(target)
            second_trigger_iso = scenario.second_trigger_for(h.id, h.second_trigger_date)
            is_double = h.equity_type == "RSU (double trigger)"
            second_trigger_passed = True
            if is_double and second_trigger_iso:
                try:
                    second_trigger_passed = target >= date.fromisoformat(second_trigger_iso)
                except ValueError:
                    pass
            liquid_avail = vested if (not is_double or second_trigger_passed) else 0.0
            shares_actually = min(shares_to_sell, liquid_avail)

            # Cost basis: for RSUs taxed at vest, basis = vest price ≈ current price for already-vested.
            # We approximate using cost_basis_per_share if set; otherwise current price (no gain).
            cost_basis = h.cost_basis_per_share if h.cost_basis_per_share > 0 else h.current_share_price
            # Pragmatic holding period proxy: time from today to target date.
            # For RSUs taxed at vest, basis = vest price, so this measures LT eligibility from vest forward.
            holding_period = max(0.0, (target - date.today()).days / 365.25)

            tx = stock_sale_tax(
                jurisdiction=h.jurisdiction,
                sale_price_per_share=projected_price_native,
                cost_basis_per_share=cost_basis,
                shares=shares_actually,
                holding_period_years=holding_period,
                settings=settings,
            )

            gross_p = convert(tx["gross_proceeds"], h.currency, primary_ccy, settings)
            tax_p = convert(tx["tax"], h.currency, primary_ccy, settings)
            net_p = convert(tx["net_proceeds"], h.currency, primary_ccy, settings)

            label = f"{h.ticker or h.company_name} — {shares_actually:,.0f} sh @ ~{projected_price_native:,.2f} {h.currency}"
            detail = dict(tx)
            detail["projected_price_native"] = projected_price_native
            detail["liquid_shares_available"] = liquid_avail
            detail["shares_requested"] = shares_to_sell
            detail["shares_sold"] = shares_actually
            if shares_actually < shares_to_sell:
                detail["warning"] = (
                    f"Only {liquid_avail:,.0f} shares liquid at {target.isoformat()}; capped from {shares_to_sell:,.0f}."
                )

            lines.append(
                FundingLineResult(
                    kind="stock",
                    asset_label=label,
                    gross_proceeds=gross_p,
                    tax=tax_p,
                    net_proceeds=net_p,
                    detail=detail,
                )
            )
            continue

        if fs.kind == "property":
            p = properties_by_id.get(fs.asset_id or "")
            if not p:
                lines.append(FundingLineResult(kind="property", asset_label="(missing)", gross_proceeds=0, tax=0, net_proceeds=0,
                                               detail={"error": f"Property {fs.asset_id} not found"}))
                continue
            fraction = max(0.0, min(1.0, float(fs.amount_or_shares)))

            # Compute projected value directly in property's native currency
            v_native = project_property_value_at(p, scenario, target, p.currency, settings, growth_service)
            sale_price_native = v_native["gross"] * fraction

            cost_basis_native = p.purchase_price * fraction
            holding_period = years_between(p.purchase_date, target)
            mortgage_payoff_native = p.mortgage_balance * fraction  # crude proportional

            tx = property_sale_tax(
                jurisdiction=p.jurisdiction,
                sale_price=sale_price_native,
                cost_basis=cost_basis_native,
                holding_period_years=holding_period,
                mortgage_balance=mortgage_payoff_native,
                is_primary_residence=False,  # toggled in UI by user editing tax_overrides if PPOR
                settings=settings,
            )

            gross_p = convert(tx["sale_price"], p.currency, primary_ccy, settings)
            tax_p = convert(tx["tax"], p.currency, primary_ccy, settings)
            net_p = convert(tx["net_to_owner"], p.currency, primary_ccy, settings)

            label = f"{p.name} — sell {fraction*100:.0f}% @ ~{sale_price_native:,.0f} {p.currency}"
            detail = dict(tx)
            detail["fraction_sold"] = fraction
            detail["holding_period_years"] = round(holding_period, 2)

            lines.append(
                FundingLineResult(
                    kind="property",
                    asset_label=label,
                    gross_proceeds=gross_p,
                    tax=tax_p,
                    net_proceeds=net_p,
                    detail=detail,
                )
            )
            continue

    total_gross = sum(l.gross_proceeds for l in lines)
    total_tax = sum(l.tax for l in lines)
    total_net = sum(l.net_proceeds for l in lines)

    return ProjectEvaluation(
        project_id=project.id,
        project_name=project.name,
        scenario_id=scenario.id,
        scenario_name=scenario.name,
        target_date=project.target_date,
        primary_currency=primary_ccy,
        total_cost=total_cost,
        funding_lines=lines,
        total_gross=total_gross,
        total_tax=total_tax,
        total_net_funding=total_net,
        surplus_or_shortfall=total_net - total_cost,
    )
