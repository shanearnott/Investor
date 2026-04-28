"""Property growth-rate providers.

Two providers ship by default:
  - ZillowZHVIProvider: US ZIP-level CAGR from Zillow's public ZHVI CSV.
  - AusSeedProvider: AUS suburb seed dataset bundled in data/seed/aus_suburb_growth.json.

Both fall back to the property's own `annual_growth_pct` if no data is found.
The Zillow CSV is downloaded on demand and cached under data/cache/.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional, Protocol

import pandas as pd

log = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SEED_DIR = DATA_DIR / "seed"
CACHE_DIR = DATA_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Zillow public ZHVI by ZIP, all-homes, time series. Public, no auth needed.
ZILLOW_ZHVI_ZIP_URL = (
    "https://files.zillowstatic.com/research/public_csvs/zhvi/"
    "Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv"
)
ZILLOW_CACHE = CACHE_DIR / "zillow_zhvi_zip.csv"


class GrowthProvider(Protocol):
    def lookup(self, *, country: str, region: str, suburb: str, postcode: str) -> Optional[float]:
        """Return annual growth %% (e.g. 5.0) or None if not found."""
        ...


# ---------- Zillow (US) ----------


class ZillowZHVIProvider:
    """Computes 5y CAGR per US ZIP from Zillow ZHVI."""

    def __init__(self, cache_path: Path = ZILLOW_CACHE):
        self.cache_path = cache_path
        self._df: Optional[pd.DataFrame] = None  # ZIP -> 5y CAGR

    def _ensure_loaded(self) -> None:
        if self._df is not None:
            return
        if not self.cache_path.exists():
            return  # Not refreshed yet; lookups will return None.
        try:
            df = pd.read_csv(self.cache_path, low_memory=False)
        except Exception as e:
            log.warning("Failed to read Zillow cache: %s", e)
            return
        # Identify time-series columns (look like YYYY-MM-DD).
        date_cols = [c for c in df.columns if len(str(c)) == 10 and str(c)[4] == "-"]
        if not date_cols:
            return
        date_cols.sort()
        # Use last 60 months for 5y CAGR (or as many as available).
        recent = date_cols[-60:] if len(date_cols) >= 60 else date_cols
        if len(recent) < 12:
            return
        first, last = recent[0], recent[-1]
        years = (pd.to_datetime(last) - pd.to_datetime(first)).days / 365.25
        if years <= 0:
            return
        # ZHVI files may use 'RegionName' as the ZIP and may be int.
        zip_col = "RegionName" if "RegionName" in df.columns else df.columns[2]
        out = df[[zip_col, first, last]].copy()
        out.columns = ["zip", "start_value", "end_value"]
        out = out.dropna(subset=["start_value", "end_value"])
        out = out[(out["start_value"] > 0) & (out["end_value"] > 0)]
        out["cagr_pct"] = ((out["end_value"] / out["start_value"]) ** (1.0 / years) - 1.0) * 100.0
        out["zip"] = out["zip"].astype(str).str.zfill(5)
        self._df = out.set_index("zip")[["cagr_pct"]]

    def refresh(self) -> tuple[bool, str]:
        """Download Zillow CSV. Returns (success, message)."""
        try:
            import requests
            log.info("Fetching Zillow ZHVI...")
            r = requests.get(ZILLOW_ZHVI_ZIP_URL, timeout=60)
            r.raise_for_status()
            self.cache_path.write_bytes(r.content)
            self._df = None  # invalidate cache
            return True, f"Downloaded {len(r.content) // 1024} KB"
        except Exception as e:
            return False, f"Refresh failed: {e}"

    def lookup(self, *, country: str, region: str, suburb: str, postcode: str) -> Optional[float]:
        if (country or "").lower() not in {"united states", "usa", "us"}:
            return None
        if not postcode:
            return None
        self._ensure_loaded()
        if self._df is None:
            return None
        z = str(postcode).zfill(5)
        if z in self._df.index:
            v = float(self._df.loc[z, "cagr_pct"])
            # Sanity clamp: ignore wildly improbable values from sparse ZIPs.
            if -20 <= v <= 30:
                return round(v, 2)
        return None


# ---------- AUS seed ----------


class AusSeedProvider:
    """AUS suburb growth from bundled JSON seed dataset."""

    def __init__(self, seed_path: Path = SEED_DIR / "aus_suburb_growth.json"):
        self.seed_path = seed_path
        self._data: Optional[dict] = None

    def _ensure_loaded(self) -> None:
        if self._data is not None:
            return
        if not self.seed_path.exists():
            self._data = {"suburbs": {}, "fallback_by_capital": {}, "national_default": 4.0}
            return
        with self.seed_path.open("r", encoding="utf-8") as f:
            self._data = json.load(f)

    def lookup(self, *, country: str, region: str, suburb: str, postcode: str) -> Optional[float]:
        if (country or "").lower() not in {"australia", "aus", "au"}:
            return None
        self._ensure_loaded()
        if not self._data:
            return None
        # Best match: try (any-capital|region|suburb), then by region fallback, then national
        suburbs = self._data.get("suburbs", {})
        if suburb and region:
            for key, v in suburbs.items():
                parts = key.split("|")
                if len(parts) == 3 and parts[1].upper() == region.upper() and parts[2].lower() == suburb.lower():
                    return float(v)
        fallback = self._data.get("fallback_by_capital", {})
        if region and region.upper() in fallback:
            return float(fallback[region.upper()])
        nd = self._data.get("national_default")
        return float(nd) if nd is not None else None


# ---------- Aggregator ----------


class GrowthRateService:
    def __init__(self, providers: Optional[list[GrowthProvider]] = None):
        self.providers = providers or [ZillowZHVIProvider(), AusSeedProvider()]

    def lookup(self, *, country: str, region: str, suburb: str, postcode: str, fallback_pct: float) -> tuple[float, str]:
        """Return (rate, source). Source is provider name or 'manual' if fallback used."""
        for p in self.providers:
            v = p.lookup(country=country, region=region, suburb=suburb, postcode=postcode)
            if v is not None:
                return v, p.__class__.__name__
        return fallback_pct, "manual"

    def refresh_all(self) -> dict[str, str]:
        results = {}
        for p in self.providers:
            if hasattr(p, "refresh"):
                ok, msg = p.refresh()
                results[p.__class__.__name__] = ("ok: " if ok else "err: ") + msg
        return results
