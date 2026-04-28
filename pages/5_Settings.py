"""Settings page: currencies, FX rates, tax overrides, growth-data refresh."""

from __future__ import annotations

import streamlit as st

from investor.growth import GrowthRateService
from investor.models import SUPPORTED_CURRENCIES, SUPPORTED_JURISDICTIONS, Settings
from investor.storage import load_settings, save_settings
from investor.tax import DEFAULTS as TAX_DEFAULTS, get_rules

st.set_page_config(page_title="Settings · Investor", page_icon="⚙️", layout="wide")
st.title("Settings")

settings = load_settings()

st.subheader("Currency")
c1, c2 = st.columns(2)
primary = c1.selectbox(
    "Primary currency",
    options=SUPPORTED_CURRENCIES,
    index=SUPPORTED_CURRENCIES.index(settings.primary_currency),
)
secondary = c2.selectbox(
    "Secondary currency (shown alongside primary)",
    options=SUPPORTED_CURRENCIES,
    index=SUPPORTED_CURRENCIES.index(settings.secondary_currency),
)

default_juris = st.selectbox(
    "Default tax jurisdiction (for new investments)",
    options=SUPPORTED_JURISDICTIONS,
    index=SUPPORTED_JURISDICTIONS.index(settings.default_jurisdiction) if settings.default_jurisdiction in SUPPORTED_JURISDICTIONS else 0,
)

st.divider()
st.subheader("FX rates")
st.caption("Rates expressed as **1 USD = X currency**. Edit any cell.")
fx_rows = [{"currency": k, "rate_per_usd": float(v)} for k, v in settings.fx_rates.items()]
fx_df = st.data_editor(
    fx_rows,
    num_rows="dynamic",
    use_container_width=True,
    column_config={
        "currency": st.column_config.SelectboxColumn("Currency", options=SUPPORTED_CURRENCIES),
        "rate_per_usd": st.column_config.NumberColumn("1 USD = ", format="%.4f", min_value=0.0001),
    },
)

st.divider()
st.subheader("Tax overrides")
st.caption(
    "Defaults are top-marginal estimates per jurisdiction. Override any field below "
    "(rates as decimals: 0.50 = 50%; cgt_discount_pct as percentage: 50)."
)

juris_to_edit = st.selectbox("Jurisdiction to view/override", options=SUPPORTED_JURISDICTIONS)
rules = get_rules(juris_to_edit, settings)
existing_ov = settings.tax_overrides.get(juris_to_edit, {})

OVERRIDE_FIELDS = [
    ("ordinary_income_rate", "Ordinary income rate (0..1)"),
    ("short_term_cap_gains_rate", "Short-term capital gains rate"),
    ("long_term_cap_gains_rate", "Long-term capital gains rate"),
    ("long_term_threshold_years", "Long-term threshold (years)"),
    ("cgt_discount_pct", "CGT discount % (e.g. 50 for AUS 50%)"),
    ("property_cgt_rate", "Property CGT rate"),
    ("property_cgt_discount_pct", "Property CGT discount %"),
    ("rsu_vest_taxed_as_income", "RSU vest taxed as income (1/0)"),
    ("primary_residence_exempt", "Primary residence exempt (1/0)"),
]

new_overrides = {}
for field, label in OVERRIDE_FIELDS:
    base_val = getattr(rules, field)
    cur_val = existing_ov.get(field, base_val)
    if isinstance(base_val, bool):
        v = st.checkbox(label, value=bool(cur_val), key=f"ov_{juris_to_edit}_{field}")
        if v != base_val:
            new_overrides[field] = v
    else:
        v = st.number_input(label, value=float(cur_val), step=0.01, format="%.4f",
                            key=f"ov_{juris_to_edit}_{field}")
        if abs(v - float(base_val)) > 1e-9:
            new_overrides[field] = v

st.caption(f"_Default rules: {rules.notes or '—'}_")

st.divider()
st.subheader("Growth-rate data")
st.caption("Zillow ZHVI is downloaded on demand and cached locally. AUS seed data ships with the app.")

if st.button("Refresh Zillow ZHVI cache", key="refresh_growth"):
    svc = GrowthRateService()
    results = svc.refresh_all()
    for k, v in results.items():
        st.write(f"**{k}:** {v}")

st.divider()
if st.button("💾 Save settings", type="primary"):
    fx = {row["currency"]: float(row["rate_per_usd"]) for row in fx_df if row.get("currency")}
    new_tax_overrides = dict(settings.tax_overrides)
    if new_overrides:
        new_tax_overrides[juris_to_edit] = new_overrides
    elif juris_to_edit in new_tax_overrides:
        # All cleared back to defaults
        del new_tax_overrides[juris_to_edit]

    save_settings(Settings(
        primary_currency=primary,
        secondary_currency=secondary,
        fx_rates=fx,
        default_jurisdiction=default_juris,
        tax_overrides=new_tax_overrides,
    ))
    st.success("Settings saved.")
    st.rerun()
