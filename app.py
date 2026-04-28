"""Investor — personal investment tracker, scenario projector, and project evaluator.

Run with: streamlit run app.py
"""

from __future__ import annotations

import streamlit as st

from investor.storage import load_settings, load_stocks, load_properties, load_scenarios, load_projects

st.set_page_config(page_title="Investor", page_icon="📈", layout="wide")


def main() -> None:
    settings = load_settings()
    stocks = load_stocks()
    properties = load_properties()
    scenarios = load_scenarios()
    projects = load_projects()

    st.title("📈 Investor")
    st.caption("Personal investment tracker · scenario projections · investment project evaluation")

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Stocks", len(stocks))
    col2.metric("Properties", len(properties))
    col3.metric("Scenarios", len(scenarios))
    col4.metric("Projects", len(projects))

    st.divider()

    st.subheader("Quick start")
    st.markdown(
        """
1. **Investments** → add your stocks (with vesting schedules and second-trigger date if applicable) and properties.
2. **Scenarios** → create one or more future scenarios (bear / base / bull). Override per-asset growth rates if you want.
3. **Projections** → see your net worth over time as a sand chart and pie breakdowns.
4. **Projects** → model investment projects (e.g. buying a home, car) and check whether your liquidations cover the cost net of tax.
5. **Settings** → set primary/secondary currency, FX rates, and tax overrides.
"""
    )

    st.subheader("Settings summary")
    s = settings
    st.write(
        f"Primary: **{s.primary_currency}** · Secondary: **{s.secondary_currency}** · "
        f"Default jurisdiction: **{s.default_jurisdiction}**"
    )

    if not stocks and not properties:
        st.info("👈 Use the sidebar to navigate to **Investments** and add your first holding.")


if __name__ == "__main__":
    main()
