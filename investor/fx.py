"""FX conversion. Rates are stored in Settings as 1 USD = X <currency>."""

from __future__ import annotations

from .models import Settings


def convert(amount: float, from_ccy: str, to_ccy: str, settings: Settings) -> float:
    if from_ccy == to_ccy:
        return amount
    rates = settings.fx_rates or {}
    if from_ccy not in rates or to_ccy not in rates:
        # Unknown currency: pass through unchanged (fail open rather than zeroing).
        return amount
    # Convert via USD: amount_in_usd = amount / rates[from], then * rates[to]
    usd = amount / rates[from_ccy] if rates[from_ccy] else amount
    return usd * rates[to_ccy]
