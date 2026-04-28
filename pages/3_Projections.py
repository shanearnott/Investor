"""Projections page: net worth over time (line + sand chart) and pie breakdowns."""

from __future__ import annotations

from datetime import date

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from investor.fx import convert
from investor.growth import GrowthRateService
from investor.models import Scenario
from investor.projections import (
    ProjectionConfig,
    build_networth_series,
    current_allocation_breakdown,
    future_allocation_breakdown,
)
from investor.storage import load_properties, load_scenarios, load_settings, load_stocks

st.set_page_config(page_title="Projections · Investor", page_icon="📊", layout="wide")
st.title("Projections")

settings = load_settings()
stocks = load_stocks()
properties = load_properties()
scenarios = load_scenarios()
growth_service = GrowthRateService()

if not stocks and not properties:
    st.warning("Add some stocks or properties on the **Investments** page first.")
    st.stop()

if not scenarios:
    st.info("No saved scenarios — using a default 'Base case' (8% stocks, 4% property, 10y).")
    scenarios = [Scenario(name="Base case", horizon_years=10)]

# Scenario picker (multi-select for line comparison)
sc_names = [s.name for s in scenarios]
chosen_names = st.multiselect("Compare scenarios", options=sc_names, default=[sc_names[0]])
if not chosen_names:
    st.stop()
chosen = [s for s in scenarios if s.name in chosen_names]

primary_ccy = settings.primary_currency
secondary_ccy = settings.secondary_currency

# Build series for each chosen scenario
series_by_scenario: dict[str, pd.DataFrame] = {}
for sc in chosen:
    df = build_networth_series(
        holdings=stocks,
        properties=properties,
        scenario=sc,
        settings=settings,
        config=ProjectionConfig(horizon_years=sc.horizon_years, step_months=1),
        growth_service=growth_service,
    )
    series_by_scenario[sc.name] = df

# ---------- KPIs (today's snapshot) ----------

today = date.today()
today_total = 0.0
liquid_today = 0.0
illiquid_today = 0.0
unvested_today = 0.0
property_today = 0.0
for sc_name, df in series_by_scenario.items():
    # Same "today" regardless of scenario; use first row.
    first = df.iloc[0]
    today_total = first["total"]
    liquid_today = first["liquid_equity_total"]
    illiquid_today = first["illiquid_equity_total"]
    unvested_today = first["unvested_equity_total"]
    property_today = first["property_equity_total"]
    break  # all scenarios share row 0

c1, c2, c3, c4, c5 = st.columns(5)
c1.metric(f"Net worth today ({primary_ccy})", f"{today_total:,.0f}")
c1.caption(f"≈ {convert(today_total, primary_ccy, secondary_ccy, settings):,.0f} {secondary_ccy}")
c2.metric("Liquid equity", f"{liquid_today:,.0f}")
c3.metric("Illiquid (vested, pre-trigger)", f"{illiquid_today:,.0f}")
c4.metric("Unvested equity", f"{unvested_today:,.0f}")
c5.metric("Property equity", f"{property_today:,.0f}")

st.divider()

# ---------- Net worth over time: line chart (one line per scenario) ----------

st.subheader("Net worth over time")
line_fig = go.Figure()
for sc_name, df in series_by_scenario.items():
    line_fig.add_trace(go.Scatter(x=df.index, y=df["total"], mode="lines", name=sc_name))
line_fig.update_layout(
    yaxis_title=f"Net worth ({primary_ccy})",
    xaxis_title="Date",
    hovermode="x unified",
    height=420,
    margin=dict(t=30, b=30),
)
st.plotly_chart(line_fig, use_container_width=True)

# ---------- Sand (stacked area) chart for the FIRST chosen scenario ----------

st.subheader(f"Net-worth composition over time — {chosen[0].name}")
df0 = series_by_scenario[chosen[0].name]
sand_categories = [
    ("liquid_equity_total", "Liquid equity (vested + post-trigger)"),
    ("illiquid_equity_total", "Vested but pre-second-trigger"),
    ("unvested_equity_total", "Unvested equity"),
    ("property_equity_total", "Property equity"),
]
sand_fig = go.Figure()
for col, label in sand_categories:
    if col in df0.columns:
        sand_fig.add_trace(
            go.Scatter(
                x=df0.index,
                y=df0[col],
                mode="lines",
                stackgroup="one",
                name=label,
            )
        )
sand_fig.update_layout(
    yaxis_title=f"{primary_ccy}",
    xaxis_title="Date",
    hovermode="x unified",
    height=420,
    margin=dict(t=30, b=30),
)
st.plotly_chart(sand_fig, use_container_width=True)

# ---------- Per-asset sand chart ----------

with st.expander("Per-asset breakdown (stacked area)"):
    asset_cols = [c for c in df0.columns if c.startswith("stock:") or c.startswith("property:")]
    asset_fig = go.Figure()
    for col in asset_cols:
        asset_fig.add_trace(
            go.Scatter(x=df0.index, y=df0[col], mode="lines", stackgroup="assets",
                       name=col.replace("stock:", "📊 ").replace("property:", "🏠 "))
        )
    asset_fig.update_layout(
        yaxis_title=f"{primary_ccy}",
        height=420,
        margin=dict(t=30, b=30),
    )
    st.plotly_chart(asset_fig, use_container_width=True)

# ---------- Pie charts: current vs future ----------

st.subheader("Allocation pies")
cur_alloc = current_allocation_breakdown(
    holdings=stocks, properties=properties, settings=settings, growth_service=growth_service,
)
fut_alloc = future_allocation_breakdown(
    holdings=stocks, properties=properties, scenario=chosen[0], settings=settings,
    growth_service=growth_service,
)

c1, c2 = st.columns(2)
if cur_alloc:
    pie_cur = px.pie(
        names=list(cur_alloc.keys()),
        values=list(cur_alloc.values()),
        title=f"Current value ({primary_ccy})",
        hole=0.4,
    )
    c1.plotly_chart(pie_cur, use_container_width=True)
else:
    c1.info("No current vested value yet.")

if fut_alloc:
    pie_fut = px.pie(
        names=list(fut_alloc.keys()),
        values=list(fut_alloc.values()),
        title=f"Projected at {chosen[0].horizon_years}y ({chosen[0].name}, {primary_ccy})",
        hole=0.4,
    )
    c2.plotly_chart(pie_fut, use_container_width=True)
else:
    c2.info("No projected value.")

# ---------- Real-value toggle ----------

if any(sc.inflation_pct for sc in chosen):
    with st.expander("Real-value (inflation-adjusted) view"):
        rv_fig = go.Figure()
        for sc_name, df in series_by_scenario.items():
            if "real_total" in df.columns:
                rv_fig.add_trace(go.Scatter(x=df.index, y=df["real_total"], mode="lines", name=sc_name + " (real)"))
        rv_fig.update_layout(yaxis_title=f"Real {primary_ccy}", height=380, margin=dict(t=30, b=30))
        st.plotly_chart(rv_fig, use_container_width=True)

# ---------- Raw data ----------

with st.expander("Raw projection data"):
    sc_pick = st.selectbox("Scenario", options=list(series_by_scenario.keys()))
    st.dataframe(series_by_scenario[sc_pick].round(2), use_container_width=True)
