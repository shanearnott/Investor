"""Data models for investments, scenarios, and projects.

All models are dataclasses with to_dict / from_dict for JSON persistence.
Dates are stored as ISO strings, decimals as floats (good enough for personal finance).
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Any, Optional
import uuid


SUPPORTED_CURRENCIES = ["USD", "AUD", "GBP", "AED", "SGD", "EUR", "CAD", "NZD", "HKD"]

SUPPORTED_JURISDICTIONS = [
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
]

EQUITY_TYPES = ["Common Stock", "RSU (single trigger)", "RSU (double trigger)", "ESPP", "Stock Options"]


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _iso(d: Optional[date]) -> Optional[str]:
    if d is None:
        return None
    if isinstance(d, str):
        return d
    return d.isoformat()


def _from_iso(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    return date.fromisoformat(s)


# ---------- Stocks / equity ----------


@dataclass
class VestingTranche:
    """A single tranche in a vesting schedule.

    `vest_date` is when the shares vest (time-based trigger).
    For double-trigger RSUs the shares only become liquid after both this date
    AND the holding's `second_trigger_date` have passed.
    """
    vest_date: str  # ISO date
    shares: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "VestingTranche":
        return cls(vest_date=d["vest_date"], shares=float(d["shares"]))


@dataclass
class StockHolding:
    id: str = field(default_factory=_new_id)
    ticker: str = ""
    company_name: str = ""
    equity_type: str = "Common Stock"  # one of EQUITY_TYPES
    currency: str = "USD"
    jurisdiction: str = "California"

    # Pricing
    current_share_price: float = 0.0
    cost_basis_per_share: float = 0.0  # avg cost basis (for tax on sale)

    # For non-RSU holdings: total shares held outright.
    # For RSUs: this is the *granted, already-vested* shares not in the schedule.
    shares_owned_outright: float = 0.0

    # RSU-specific: vesting schedule of remaining unvested grants
    vesting_schedule: list[VestingTranche] = field(default_factory=list)

    # Double-trigger RSUs: estimated date the second trigger occurs
    # (typically IPO / acquisition / liquidity event). Required for double-trigger
    # to count toward liquid net worth.
    second_trigger_date: Optional[str] = None  # ISO date or None

    # Optional notes
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["vesting_schedule"] = [v.to_dict() if isinstance(v, VestingTranche) else v for v in self.vesting_schedule]
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "StockHolding":
        d = dict(d)
        d["vesting_schedule"] = [VestingTranche.from_dict(v) for v in d.get("vesting_schedule", [])]
        return cls(**d)

    # Helpers
    def total_granted_shares(self) -> float:
        """All shares granted to you, vested or unvested."""
        return self.shares_owned_outright + sum(t.shares for t in self.vesting_schedule)

    def vested_shares_at(self, as_of: date) -> float:
        """Shares vested (time-trigger met) as of a given date."""
        v = self.shares_owned_outright
        for t in self.vesting_schedule:
            if _from_iso(t.vest_date) and _from_iso(t.vest_date) <= as_of:
                v += t.shares
        return v

    def liquid_shares_at(self, as_of: date) -> float:
        """Shares that are both vested AND past the second trigger (if applicable)."""
        if self.equity_type == "RSU (double trigger)" and self.second_trigger_date:
            trigger = _from_iso(self.second_trigger_date)
            if trigger and as_of < trigger:
                # No shares are liquid yet
                return 0.0
        return self.vested_shares_at(as_of)


# ---------- Properties ----------


@dataclass
class Property:
    id: str = field(default_factory=_new_id)
    name: str = ""
    address: str = ""
    suburb: str = ""
    region: str = ""  # state / county
    country: str = "United States"  # "United States" or "Australia" supported for auto-growth
    postcode: str = ""

    purchase_price: float = 0.0
    purchase_date: Optional[str] = None  # ISO
    current_value: float = 0.0
    annual_growth_pct: float = 4.0  # manual default, overridden by provider data if available

    mortgage_balance: float = 0.0  # outstanding loan; reduces equity but counted separately

    currency: str = "USD"
    jurisdiction: str = "California"

    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Property":
        return cls(**d)

    def equity(self) -> float:
        """Owner's equity = current_value - mortgage_balance."""
        return self.current_value - self.mortgage_balance


# ---------- Scenarios ----------


@dataclass
class StockOverride:
    """Per-scenario override of stock projection assumptions."""
    annual_price_growth_pct: float = 8.0  # default growth assumption
    second_trigger_date_override: Optional[str] = None  # ISO; if set, overrides holding's value


@dataclass
class PropertyOverride:
    annual_growth_pct: float = 4.0


@dataclass
class Scenario:
    id: str = field(default_factory=_new_id)
    name: str = ""
    description: str = ""
    horizon_years: int = 10

    # Defaults applied when no per-holding override is set
    default_stock_growth_pct: float = 8.0
    default_property_growth_pct: float = 4.0

    # Per-asset overrides keyed by holding/property id
    stock_overrides: dict[str, dict[str, Any]] = field(default_factory=dict)
    property_overrides: dict[str, dict[str, Any]] = field(default_factory=dict)

    # Inflation for real-value views (optional, default off)
    inflation_pct: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Scenario":
        return cls(**d)

    def stock_growth_for(self, holding_id: str) -> float:
        return float(self.stock_overrides.get(holding_id, {}).get("annual_price_growth_pct", self.default_stock_growth_pct))

    def property_growth_for(self, property_id: str, fallback_pct: float) -> float:
        return float(self.property_overrides.get(property_id, {}).get("annual_growth_pct", fallback_pct if fallback_pct else self.default_property_growth_pct))

    def second_trigger_for(self, holding_id: str, fallback: Optional[str]) -> Optional[str]:
        v = self.stock_overrides.get(holding_id, {}).get("second_trigger_date_override")
        return v or fallback


# ---------- Projects ----------


@dataclass
class ProjectItem:
    name: str = ""
    cost: float = 0.0
    currency: str = "USD"
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ProjectItem":
        return cls(**d)


@dataclass
class FundingSource:
    """Represents a single source used to fund (part of) a project.

    kind: "stock" | "property" | "cash"
    asset_id: id of the holding/property (None for cash)
    amount_or_shares: for stock => shares to liquidate; for property => sale (1 = full sale, 0..1 fractional);
                      for cash => amount in primary currency.
    """
    kind: str = "stock"
    asset_id: Optional[str] = None
    amount_or_shares: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "FundingSource":
        return cls(**d)


@dataclass
class InvestmentProject:
    id: str = field(default_factory=_new_id)
    name: str = ""
    description: str = ""
    target_date: Optional[str] = None  # ISO; project funded by this date
    currency: str = "USD"

    items: list[ProjectItem] = field(default_factory=list)
    funding: list[FundingSource] = field(default_factory=list)

    # Default scenario to evaluate against (can be overridden in UI)
    scenario_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["items"] = [i.to_dict() if isinstance(i, ProjectItem) else i for i in self.items]
        d["funding"] = [f.to_dict() if isinstance(f, FundingSource) else f for f in self.funding]
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "InvestmentProject":
        d = dict(d)
        d["items"] = [ProjectItem.from_dict(i) for i in d.get("items", [])]
        d["funding"] = [FundingSource.from_dict(f) for f in d.get("funding", [])]
        return cls(**d)

    def total_cost(self) -> float:
        # Naive sum (assumes all items in same currency as project; UI converts on entry)
        return sum(i.cost for i in self.items)


# ---------- Settings ----------


@dataclass
class Settings:
    primary_currency: str = "USD"
    secondary_currency: str = "AUD"
    fx_rates: dict[str, float] = field(default_factory=lambda: {
        # Rates expressed as: 1 USD = X <currency>. Editable in UI.
        "USD": 1.0,
        "AUD": 1.52,
        "GBP": 0.78,
        "AED": 3.67,
        "SGD": 1.34,
        "EUR": 0.92,
        "CAD": 1.36,
        "NZD": 1.65,
        "HKD": 7.82,
    })
    default_jurisdiction: str = "California"
    # User-tunable tax overrides per jurisdiction (overlay onto defaults from tax.py)
    tax_overrides: dict[str, dict[str, float]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Settings":
        return cls(**d)
