"""Tax module.

Pragmatic model — produces an estimate of the tax owed when liquidating an
asset to fund a project. Defaults below are *indicative* and should be reviewed
by the user (overridable in Settings). Not tax advice.

Model per jurisdiction:
- ordinary_income_rate: marginal income rate (top-bracket assumed unless user lowers)
- short_term_cap_gains_rate: applied to gains on assets held < long_term_threshold_years
- long_term_cap_gains_rate: applied to gains on assets held >= threshold
- long_term_threshold_years: holding period for long-term treatment
- cgt_discount_pct: e.g. AUS 50% — gain reduced by this % before applying ordinary rate
- rsu_vest_taxed_as_income: True if RSU shares are taxed as ordinary income at vest
                             (i.e. cost basis = vest price, not grant price)

Tax on liquidation of stock:
    gain = (sale_price - cost_basis) * shares
    if cgt_discount_pct: gain_after_discount = gain * (1 - discount/100); tax = gain_after_discount * ordinary_rate
    else: tax = gain * (long_term if held>=threshold else short_term)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Optional

from .models import Settings


@dataclass
class TaxRules:
    jurisdiction: str
    ordinary_income_rate: float          # e.g. 0.50 = 50%
    short_term_cap_gains_rate: float
    long_term_cap_gains_rate: float
    long_term_threshold_years: float
    cgt_discount_pct: float              # 0..100; 0 = no discount; 50 = AUS 50% discount on >12mo
    rsu_vest_taxed_as_income: bool
    property_cgt_rate: float             # rate applied to property capital gains
    property_cgt_discount_pct: float     # discount on property gains (e.g. AUS 50%)
    primary_residence_exempt: bool       # crude flag — UI lets user mark a property as PPOR
    notes: str = ""


# Default, indicative rules. User can override per-jurisdiction in Settings.
# These are deliberately top-marginal estimates so the app errs conservative.
DEFAULTS: dict[str, TaxRules] = {
    "California": TaxRules(
        jurisdiction="California",
        ordinary_income_rate=0.50,           # ~37% federal + ~13.3% CA top
        short_term_cap_gains_rate=0.50,      # short-term taxed as ordinary
        long_term_cap_gains_rate=0.333,      # 20% federal + 13.3% CA
        long_term_threshold_years=1.0,
        cgt_discount_pct=0.0,
        rsu_vest_taxed_as_income=True,
        property_cgt_rate=0.333,
        property_cgt_discount_pct=0.0,
        primary_residence_exempt=False,      # $250k/$500k exclusion — user toggles
        notes="Federal LTCG 20% + CA top 13.3%. RSUs taxed as ordinary income at vest (cost basis = vest price).",
    ),
    "US-Federal-Only": TaxRules(
        jurisdiction="US-Federal-Only",
        ordinary_income_rate=0.37,
        short_term_cap_gains_rate=0.37,
        long_term_cap_gains_rate=0.238,      # 20% + 3.8% NIIT
        long_term_threshold_years=1.0,
        cgt_discount_pct=0.0,
        rsu_vest_taxed_as_income=True,
        property_cgt_rate=0.238,
        property_cgt_discount_pct=0.0,
        primary_residence_exempt=False,
    ),
    "Australia": TaxRules(
        jurisdiction="Australia",
        ordinary_income_rate=0.47,           # top marginal incl. Medicare levy
        short_term_cap_gains_rate=0.47,
        long_term_cap_gains_rate=0.47,       # treated as ordinary, with 50% discount if held >12mo
        long_term_threshold_years=1.0,
        cgt_discount_pct=50.0,
        rsu_vest_taxed_as_income=True,       # ESS deferred-taxing-point treated as income
        property_cgt_rate=0.47,
        property_cgt_discount_pct=50.0,
        primary_residence_exempt=True,
        notes="50% CGT discount on assets held >12mo. ESS shares taxed as income at deferred taxing point.",
    ),
    "UAE": TaxRules(
        jurisdiction="UAE",
        ordinary_income_rate=0.0,
        short_term_cap_gains_rate=0.0,
        long_term_cap_gains_rate=0.0,
        long_term_threshold_years=0.0,
        cgt_discount_pct=0.0,
        rsu_vest_taxed_as_income=False,
        property_cgt_rate=0.0,
        property_cgt_discount_pct=0.0,
        primary_residence_exempt=True,
        notes="No personal income tax or CGT for individuals.",
    ),
    "UK": TaxRules(
        jurisdiction="UK",
        ordinary_income_rate=0.45,
        short_term_cap_gains_rate=0.24,
        long_term_cap_gains_rate=0.24,
        long_term_threshold_years=0.0,
        cgt_discount_pct=0.0,
        rsu_vest_taxed_as_income=True,
        property_cgt_rate=0.24,
        property_cgt_discount_pct=0.0,
        primary_residence_exempt=True,
        notes="CGT on residential property 24% (top), other assets 24%. RSUs taxed as income at vest.",
    ),
    "Singapore": TaxRules(
        jurisdiction="Singapore",
        ordinary_income_rate=0.24,
        short_term_cap_gains_rate=0.0,
        long_term_cap_gains_rate=0.0,
        long_term_threshold_years=0.0,
        cgt_discount_pct=0.0,
        rsu_vest_taxed_as_income=True,
        property_cgt_rate=0.0,
        property_cgt_discount_pct=0.0,
        primary_residence_exempt=True,
        notes="No CGT. RSUs taxed as employment income at vest. Property may attract Seller's Stamp Duty if sold within 3y.",
    ),
    "Canada": TaxRules(
        jurisdiction="Canada",
        ordinary_income_rate=0.535,
        short_term_cap_gains_rate=0.2675,    # 50% inclusion at top
        long_term_cap_gains_rate=0.2675,
        long_term_threshold_years=0.0,
        cgt_discount_pct=50.0,
        rsu_vest_taxed_as_income=True,
        property_cgt_rate=0.2675,
        property_cgt_discount_pct=50.0,
        primary_residence_exempt=True,
    ),
    "Germany": TaxRules(
        jurisdiction="Germany",
        ordinary_income_rate=0.45,
        short_term_cap_gains_rate=0.2638,    # ~25% + Soli + church (excl)
        long_term_cap_gains_rate=0.2638,
        long_term_threshold_years=0.0,
        cgt_discount_pct=0.0,
        rsu_vest_taxed_as_income=True,
        property_cgt_rate=0.45,              # speculation tax if <10y
        property_cgt_discount_pct=0.0,
        primary_residence_exempt=True,
        notes="Property gains tax-free if held >10 years.",
    ),
    "New Zealand": TaxRules(
        jurisdiction="New Zealand",
        ordinary_income_rate=0.39,
        short_term_cap_gains_rate=0.0,
        long_term_cap_gains_rate=0.0,
        long_term_threshold_years=0.0,
        cgt_discount_pct=0.0,
        rsu_vest_taxed_as_income=True,
        property_cgt_rate=0.0,                # bright-line rules apply for resi property held <2y
        property_cgt_discount_pct=0.0,
        primary_residence_exempt=True,
    ),
    "Hong Kong": TaxRules(
        jurisdiction="Hong Kong",
        ordinary_income_rate=0.17,
        short_term_cap_gains_rate=0.0,
        long_term_cap_gains_rate=0.0,
        long_term_threshold_years=0.0,
        cgt_discount_pct=0.0,
        rsu_vest_taxed_as_income=True,
        property_cgt_rate=0.0,
        property_cgt_discount_pct=0.0,
        primary_residence_exempt=True,
    ),
    "Ireland": TaxRules(
        jurisdiction="Ireland",
        ordinary_income_rate=0.52,
        short_term_cap_gains_rate=0.33,
        long_term_cap_gains_rate=0.33,
        long_term_threshold_years=0.0,
        cgt_discount_pct=0.0,
        rsu_vest_taxed_as_income=True,
        property_cgt_rate=0.33,
        property_cgt_discount_pct=0.0,
        primary_residence_exempt=True,
    ),
}


def get_rules(jurisdiction: str, settings: Optional[Settings] = None) -> TaxRules:
    base = DEFAULTS.get(jurisdiction, DEFAULTS["US-Federal-Only"])
    if settings and settings.tax_overrides and jurisdiction in settings.tax_overrides:
        ov = settings.tax_overrides[jurisdiction]
        # Build a copy with overrides applied for fields that exist
        kwargs = base.__dict__.copy()
        for k, v in ov.items():
            if k in kwargs:
                kwargs[k] = v
        return TaxRules(**kwargs)
    return base


def stock_sale_tax(
    *,
    jurisdiction: str,
    sale_price_per_share: float,
    cost_basis_per_share: float,
    shares: float,
    holding_period_years: float,
    settings: Optional[Settings] = None,
) -> dict[str, float]:
    """Tax on a stock sale. Returns dict with gross_proceeds, gain, tax, net_proceeds, effective_rate."""
    rules = get_rules(jurisdiction, settings)
    gross = sale_price_per_share * shares
    gain = max(0.0, (sale_price_per_share - cost_basis_per_share) * shares)

    if rules.cgt_discount_pct > 0 and holding_period_years >= rules.long_term_threshold_years:
        # AUS-style: gain discounted, then taxed at ordinary rate
        taxable_gain = gain * (1 - rules.cgt_discount_pct / 100.0)
        rate = rules.ordinary_income_rate
        tax = taxable_gain * rate
    elif holding_period_years >= rules.long_term_threshold_years:
        rate = rules.long_term_cap_gains_rate
        tax = gain * rate
    else:
        rate = rules.short_term_cap_gains_rate
        tax = gain * rate

    net = gross - tax
    return {
        "gross_proceeds": gross,
        "cost_basis_total": cost_basis_per_share * shares,
        "gain": gain,
        "tax": tax,
        "net_proceeds": net,
        "effective_rate_on_gain": (tax / gain) if gain > 0 else 0.0,
        "rules_used": rules.jurisdiction,
    }


def property_sale_tax(
    *,
    jurisdiction: str,
    sale_price: float,
    cost_basis: float,
    holding_period_years: float,
    mortgage_balance: float = 0.0,
    is_primary_residence: bool = False,
    settings: Optional[Settings] = None,
) -> dict[str, float]:
    """Tax on a property sale."""
    rules = get_rules(jurisdiction, settings)
    gain = max(0.0, sale_price - cost_basis)

    if is_primary_residence and rules.primary_residence_exempt:
        # Crude — most jurisdictions have caps (e.g. US $250k/$500k); user can override.
        tax = 0.0
        taxable_gain = 0.0
    elif rules.property_cgt_discount_pct > 0:
        taxable_gain = gain * (1 - rules.property_cgt_discount_pct / 100.0)
        tax = taxable_gain * rules.ordinary_income_rate
    else:
        taxable_gain = gain
        tax = gain * rules.property_cgt_rate

    net_after_tax = sale_price - tax
    net_to_owner = net_after_tax - mortgage_balance
    return {
        "sale_price": sale_price,
        "cost_basis": cost_basis,
        "gain": gain,
        "taxable_gain": taxable_gain,
        "tax": tax,
        "mortgage_payoff": mortgage_balance,
        "net_to_owner": net_to_owner,
        "rules_used": rules.jurisdiction,
    }


def years_between(start_iso: Optional[str], end: date) -> float:
    if not start_iso:
        return 0.0
    start = date.fromisoformat(start_iso)
    return max(0.0, (end - start).days / 365.25)
