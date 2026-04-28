"""Projection engine.

Produces a monthly net-worth series across a horizon, broken down by category:
  - vested_liquid_equity: shares vested AND past second trigger
  - vested_illiquid_equity: shares vested but pre-second-trigger (paper value)
  - unvested_equity: shares not yet vested (paper value)
  - property_equity: current_value - mortgage_balance
  - property_gross: current_value (informational)

All values are returned in the user's primary currency.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional

import pandas as pd
from dateutil.relativedelta import relativedelta

from .fx import convert
from .growth import GrowthRateService
from .models import Property, Scenario, Settings, StockHolding


@dataclass
class ProjectionConfig:
    horizon_years: int
    step_months: int = 1
    start: Optional[date] = None  # default = today


def _month_iter(start: date, horizon_years: int, step_months: int = 1):
    months = horizon_years * 12
    cur = start.replace(day=1)
    for i in range(0, months + 1, step_months):
        yield cur + relativedelta(months=i)


def project_stock_value_at(
    holding: StockHolding,
    scenario: Scenario,
    as_of: date,
    primary_ccy: str,
    settings: Settings,
) -> dict[str, float]:
    """Returns {liquid, illiquid_vested, unvested} in primary currency for a stock holding at a date."""
    today = date.today()
    months_forward = max(0, (as_of.year - today.year) * 12 + (as_of.month - today.month))
    growth_pct = scenario.stock_growth_for(holding.id)
    monthly_growth = (1 + growth_pct / 100.0) ** (1 / 12) - 1
    projected_price = holding.current_share_price * ((1 + monthly_growth) ** months_forward)

    vested = holding.vested_shares_at(as_of)
    granted = holding.total_granted_shares()
    unvested = max(0.0, granted - vested)

    # Determine liquid vs illiquid-vested based on second trigger
    second_trigger_iso = scenario.second_trigger_for(holding.id, holding.second_trigger_date)
    is_double = holding.equity_type == "RSU (double trigger)"
    second_trigger_passed = True
    if is_double and second_trigger_iso:
        try:
            second_trigger_passed = as_of >= date.fromisoformat(second_trigger_iso)
        except ValueError:
            second_trigger_passed = True

    if is_double and not second_trigger_passed:
        liquid_shares = 0.0
        illiquid_shares = vested
    else:
        liquid_shares = vested
        illiquid_shares = 0.0

    liquid = liquid_shares * projected_price
    illiquid = illiquid_shares * projected_price
    unvested_val = unvested * projected_price

    return {
        "liquid": convert(liquid, holding.currency, primary_ccy, settings),
        "illiquid_vested": convert(illiquid, holding.currency, primary_ccy, settings),
        "unvested": convert(unvested_val, holding.currency, primary_ccy, settings),
        "shares_vested": vested,
        "shares_unvested": unvested,
        "projected_price": projected_price,
    }


def project_property_value_at(
    prop: Property,
    scenario: Scenario,
    as_of: date,
    primary_ccy: str,
    settings: Settings,
    growth_service: Optional[GrowthRateService] = None,
) -> dict[str, float]:
    today = date.today()
    months_forward = max(0, (as_of.year - today.year) * 12 + (as_of.month - today.month))

    # Resolve growth: scenario override > provider lookup > property's own field
    if growth_service is not None:
        provider_rate, _src = growth_service.lookup(
            country=prop.country,
            region=prop.region,
            suburb=prop.suburb,
            postcode=prop.postcode,
            fallback_pct=prop.annual_growth_pct,
        )
    else:
        provider_rate = prop.annual_growth_pct
    growth_pct = scenario.property_growth_for(prop.id, provider_rate)
    monthly_growth = (1 + growth_pct / 100.0) ** (1 / 12) - 1
    projected_value = prop.current_value * ((1 + monthly_growth) ** months_forward)

    # Mortgage assumed flat over horizon (we don't model amortization yet — pragmatic).
    equity = projected_value - prop.mortgage_balance

    return {
        "gross": convert(projected_value, prop.currency, primary_ccy, settings),
        "equity": convert(equity, prop.currency, primary_ccy, settings),
        "mortgage": convert(prop.mortgage_balance, prop.currency, primary_ccy, settings),
        "growth_pct_used": growth_pct,
    }


def build_networth_series(
    *,
    holdings: list[StockHolding],
    properties: list[Property],
    scenario: Scenario,
    settings: Settings,
    config: ProjectionConfig,
    growth_service: Optional[GrowthRateService] = None,
) -> pd.DataFrame:
    """Returns a DataFrame indexed by month with columns for each category and per-asset.

    Column scheme:
      total
      liquid_equity_total, illiquid_equity_total, unvested_equity_total
      property_equity_total, property_gross_total
      stock:<ticker> (liquid + illiquid + unvested combined for stacked-area asset view)
      property:<name>
    """
    start = config.start or date.today()
    rows = []
    for as_of in _month_iter(start, config.horizon_years, config.step_months):
        row: dict[str, float] = {"date": pd.Timestamp(as_of)}
        liquid_eq = illiquid_eq = unvested_eq = 0.0
        prop_eq = prop_gross = 0.0

        for h in holdings:
            v = project_stock_value_at(h, scenario, as_of, settings.primary_currency, settings)
            row[f"stock:{h.ticker or h.company_name or h.id}"] = v["liquid"] + v["illiquid_vested"] + v["unvested"]
            liquid_eq += v["liquid"]
            illiquid_eq += v["illiquid_vested"]
            unvested_eq += v["unvested"]

        for p in properties:
            v = project_property_value_at(p, scenario, as_of, settings.primary_currency, settings, growth_service)
            row[f"property:{p.name or p.id}"] = v["equity"]
            prop_eq += v["equity"]
            prop_gross += v["gross"]

        row["liquid_equity_total"] = liquid_eq
        row["illiquid_equity_total"] = illiquid_eq
        row["unvested_equity_total"] = unvested_eq
        row["property_equity_total"] = prop_eq
        row["property_gross_total"] = prop_gross
        row["total"] = liquid_eq + illiquid_eq + unvested_eq + prop_eq
        rows.append(row)

    df = pd.DataFrame(rows).set_index("date")
    # Apply inflation for "real" view if requested (returns nominal by default)
    if scenario.inflation_pct and scenario.inflation_pct != 0.0:
        infl_monthly = (1 + scenario.inflation_pct / 100.0) ** (1 / 12) - 1
        deflator = pd.Series(
            [(1 + infl_monthly) ** i for i in range(len(df))],
            index=df.index,
        )
        for col in df.columns:
            df[f"real_{col}"] = df[col] / deflator
    return df


def current_allocation_breakdown(
    *,
    holdings: list[StockHolding],
    properties: list[Property],
    settings: Settings,
    growth_service: Optional[GrowthRateService] = None,
) -> dict[str, float]:
    """Today's allocation by asset, in primary currency. Used for current-value pie chart."""
    today = date.today()
    out: dict[str, float] = {}
    # Use a no-growth scenario for "today" snapshot
    snapshot = Scenario(name="snapshot", horizon_years=0, default_stock_growth_pct=0.0, default_property_growth_pct=0.0)
    for h in holdings:
        v = project_stock_value_at(h, snapshot, today, settings.primary_currency, settings)
        # Vested + liquid count toward "current"; unvested shown separately
        cur = v["liquid"] + v["illiquid_vested"]
        if cur > 0:
            out[f"{h.ticker or h.company_name} (vested)"] = out.get(f"{h.ticker or h.company_name} (vested)", 0) + cur
    for p in properties:
        v = project_property_value_at(p, snapshot, today, settings.primary_currency, settings, growth_service)
        if v["equity"] > 0:
            out[f"{p.name} (property)"] = v["equity"]
    return out


def future_allocation_breakdown(
    *,
    holdings: list[StockHolding],
    properties: list[Property],
    scenario: Scenario,
    settings: Settings,
    at_year_offset: Optional[int] = None,
    growth_service: Optional[GrowthRateService] = None,
) -> dict[str, float]:
    """Allocation at horizon (or at_year_offset). Includes unvested + liquid + illiquid."""
    today = date.today()
    yrs = at_year_offset if at_year_offset is not None else scenario.horizon_years
    as_of = today + relativedelta(years=yrs)
    out: dict[str, float] = {}
    for h in holdings:
        v = project_stock_value_at(h, scenario, as_of, settings.primary_currency, settings)
        total = v["liquid"] + v["illiquid_vested"] + v["unvested"]
        if total > 0:
            out[f"{h.ticker or h.company_name}"] = total
    for p in properties:
        v = project_property_value_at(p, scenario, as_of, settings.primary_currency, settings, growth_service)
        if v["equity"] > 0:
            out[f"{p.name} (property)"] = v["equity"]
    return out
