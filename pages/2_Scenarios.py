"""Scenarios page: define and save future scenarios with per-asset overrides."""

from __future__ import annotations

import streamlit as st

from investor.models import Scenario
from investor.storage import (
    delete_scenario,
    load_properties,
    load_scenarios,
    load_stocks,
    upsert_scenario,
)

st.set_page_config(page_title="Scenarios · Investor", page_icon="🔮", layout="wide")
st.title("Scenarios")
st.caption("Each scenario captures a set of growth assumptions. Use them in **Projections** and **Projects**.")

stocks = load_stocks()
properties = load_properties()
scenarios = load_scenarios()

st.subheader("Existing scenarios")
if scenarios:
    for s in scenarios:
        with st.expander(
            f"**{s.name}** · {s.horizon_years}y · stocks {s.default_stock_growth_pct:.1f}%/yr · "
            f"property {s.default_property_growth_pct:.1f}%/yr",
            expanded=False,
        ):
            if s.description:
                st.write(s.description)
            if s.stock_overrides:
                st.write("**Stock overrides:**")
                st.json(s.stock_overrides)
            if s.property_overrides:
                st.write("**Property overrides:**")
                st.json(s.property_overrides)
            if s.inflation_pct:
                st.write(f"**Inflation:** {s.inflation_pct:.1f}%/yr")
            if st.button("Delete", key=f"del_sc_{s.id}", type="secondary"):
                delete_scenario(s.id)
                st.rerun()
else:
    st.info("No scenarios yet. Create one below — e.g. 'Base case', 'Bear', 'Bull', 'IPO 2027'.")

st.divider()
st.subheader("Add or update a scenario")

edit_id = st.selectbox(
    "Edit existing (or 'New' to add)",
    options=["New"] + [f"{s.name} ({s.id})" for s in scenarios],
    key="sc_edit_select",
)
editing: Scenario | None = None
if edit_id != "New":
    sid = edit_id.split("(")[-1].rstrip(")")
    editing = next((s for s in scenarios if s.id == sid), None)

with st.form("scenario_form", clear_on_submit=False):
    c1, c2, c3 = st.columns(3)
    name = c1.text_input("Name", value=editing.name if editing else "Base case")
    horizon = c2.number_input("Horizon (years)", min_value=1, max_value=50,
                              value=int(editing.horizon_years) if editing else 10)
    inflation = c3.number_input("Inflation %/yr (for real-value view)", value=float(editing.inflation_pct) if editing else 0.0, step=0.1)

    desc = st.text_area("Description", value=editing.description if editing else "")

    c1, c2 = st.columns(2)
    default_stock = c1.number_input(
        "Default stock growth %/yr",
        value=float(editing.default_stock_growth_pct) if editing else 8.0,
        step=0.5,
    )
    default_prop = c2.number_input(
        "Default property growth %/yr",
        value=float(editing.default_property_growth_pct) if editing else 4.0,
        step=0.5,
    )

    st.markdown("**Per-stock overrides** — leave blank to use the default")
    stock_rows = []
    for h in stocks:
        existing_ov = (editing.stock_overrides.get(h.id, {}) if editing else {})
        c1, c2, c3 = st.columns([2, 2, 2])
        c1.write(f"{h.ticker or h.company_name}")
        rate = c2.number_input(
            f"Growth %/yr [{h.id}]",
            value=float(existing_ov.get("annual_price_growth_pct", default_stock)),
            step=0.5,
            key=f"sg_{h.id}",
            label_visibility="collapsed",
        )
        trig = c3.text_input(
            f"Second trigger override (YYYY-MM-DD) [{h.id}]",
            value=existing_ov.get("second_trigger_date_override", "") or "",
            key=f"st_{h.id}",
            label_visibility="collapsed",
            placeholder="YYYY-MM-DD (optional)",
        )
        stock_rows.append((h.id, rate, trig))

    st.markdown("**Per-property overrides** — leave blank to use provider/default")
    prop_rows = []
    for p in properties:
        existing_ov = (editing.property_overrides.get(p.id, {}) if editing else {})
        c1, c2 = st.columns([3, 2])
        c1.write(f"{p.name} ({p.suburb}, {p.region})")
        rate = c2.number_input(
            f"Growth %/yr [{p.id}]",
            value=float(existing_ov.get("annual_growth_pct", default_prop)),
            step=0.5,
            key=f"pg_{p.id}",
            label_visibility="collapsed",
        )
        prop_rows.append((p.id, rate))

    submit = st.form_submit_button("Save scenario", type="primary")
    if submit:
        stock_overrides: dict[str, dict] = {}
        for hid, rate, trig in stock_rows:
            ov: dict = {"annual_price_growth_pct": rate}
            if trig.strip():
                ov["second_trigger_date_override"] = trig.strip()
            stock_overrides[hid] = ov

        property_overrides: dict[str, dict] = {pid: {"annual_growth_pct": rate} for pid, rate in prop_rows}

        sc = Scenario(
            id=editing.id if editing else Scenario().id,
            name=name.strip(),
            description=desc.strip(),
            horizon_years=int(horizon),
            default_stock_growth_pct=float(default_stock),
            default_property_growth_pct=float(default_prop),
            stock_overrides=stock_overrides,
            property_overrides=property_overrides,
            inflation_pct=float(inflation),
        )
        upsert_scenario(sc)
        st.success(f"Saved scenario '{sc.name}'.")
        st.rerun()
