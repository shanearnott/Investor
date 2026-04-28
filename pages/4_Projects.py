"""Investment Projects page: model project costs and check funding adequacy."""

from __future__ import annotations

from datetime import date

import pandas as pd
import streamlit as st

from investor.growth import GrowthRateService
from investor.models import (
    FundingSource,
    InvestmentProject,
    ProjectItem,
    Scenario,
    SUPPORTED_CURRENCIES,
)
from investor.projects_engine import evaluate_project
from investor.storage import (
    delete_project,
    load_projects,
    load_properties,
    load_scenarios,
    load_settings,
    load_stocks,
    upsert_project,
)

st.set_page_config(page_title="Projects · Investor", page_icon="🏗️", layout="wide")
st.title("Investment Projects")
st.caption("Model a project (e.g. buy a house + furniture + car), pick funding sources, and see if it works after tax.")

settings = load_settings()
stocks = load_stocks()
properties = load_properties()
scenarios = load_scenarios()
projects = load_projects()
growth_service = GrowthRateService()

if not scenarios:
    st.info("No saved scenarios — defaulting to a temporary 'Base case'. Save scenarios on the **Scenarios** page.")
    scenarios = [Scenario(name="Base case", horizon_years=10)]


# ---------- Existing projects: evaluate ----------

st.subheader("Existing projects")
if projects:
    for proj in projects:
        with st.expander(f"**{proj.name}** · target {proj.target_date or '—'} · "
                         f"{len(proj.items)} item(s) · {len(proj.funding)} funding source(s)", expanded=False):
            sc_options = {s.name: s for s in scenarios}
            default_sc_name = next((s.name for s in scenarios if s.id == proj.scenario_id), list(sc_options.keys())[0])
            sc_pick = st.selectbox(
                "Evaluate against scenario",
                options=list(sc_options.keys()),
                index=list(sc_options.keys()).index(default_sc_name),
                key=f"sc_pick_{proj.id}",
            )
            scenario = sc_options[sc_pick]

            ev = evaluate_project(
                project=proj,
                scenario=scenario,
                holdings=stocks,
                properties=properties,
                settings=settings,
                growth_service=growth_service,
            )

            ccy = ev.primary_currency
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Total cost", f"{ev.total_cost:,.0f} {ccy}")
            c2.metric("Gross funding", f"{ev.total_gross:,.0f} {ccy}")
            c3.metric("Tax owed", f"{ev.total_tax:,.0f} {ccy}")
            c4.metric("Net funding", f"{ev.total_net_funding:,.0f} {ccy}")

            if ev.is_funded:
                st.success(f"✅ Funded with surplus of **{ev.surplus_or_shortfall:,.0f} {ccy}**.")
            else:
                st.error(f"❌ Shortfall of **{abs(ev.surplus_or_shortfall):,.0f} {ccy}**.")

            st.markdown("**Funding lines:**")
            line_rows = []
            for line in ev.funding_lines:
                line_rows.append({
                    "kind": line.kind,
                    "asset": line.asset_label,
                    "gross": round(line.gross_proceeds, 2),
                    "tax": round(line.tax, 2),
                    "net": round(line.net_proceeds, 2),
                    "warning": line.detail.get("warning") or line.detail.get("error") or "",
                })
            if line_rows:
                st.dataframe(line_rows, use_container_width=True, hide_index=True)

            st.markdown("**Cost items:**")
            cost_rows = [{"name": i.name, "cost": i.cost, "currency": i.currency} for i in proj.items]
            if cost_rows:
                st.dataframe(cost_rows, use_container_width=True, hide_index=True)

            with st.expander("Per-line detail (raw)"):
                for line in ev.funding_lines:
                    st.write(f"**{line.asset_label}**")
                    st.json(line.detail)

            cdel, _ = st.columns([1, 5])
            if cdel.button("Delete project", key=f"del_proj_{proj.id}", type="secondary"):
                delete_project(proj.id)
                st.rerun()
else:
    st.info("No projects yet. Create one below.")

st.divider()
st.subheader("Add or update a project")

edit_id = st.selectbox(
    "Edit existing (or 'New')",
    options=["New"] + [f"{p.name} ({p.id})" for p in projects],
    key="proj_edit_select",
)
editing: InvestmentProject | None = None
if edit_id != "New":
    pid = edit_id.split("(")[-1].rstrip(")")
    editing = next((p for p in projects if p.id == pid), None)

with st.form("project_form", clear_on_submit=False):
    c1, c2, c3 = st.columns(3)
    name = c1.text_input("Project name", value=editing.name if editing else "")
    target = c2.text_input("Target date (YYYY-MM-DD)",
                           value=(editing.target_date or "") if editing else "")
    proj_ccy = c3.selectbox(
        "Project currency",
        options=SUPPORTED_CURRENCIES,
        index=SUPPORTED_CURRENCIES.index(editing.currency) if editing else SUPPORTED_CURRENCIES.index(settings.primary_currency),
    )

    desc = st.text_area("Description", value=editing.description if editing else "")

    sc_choices = {s.name: s for s in scenarios}
    sc_default = next((s.name for s in scenarios if s.id == editing.scenario_id), list(sc_choices.keys())[0]) if editing else list(sc_choices.keys())[0]
    sc_name = st.selectbox(
        "Default scenario for evaluation",
        options=list(sc_choices.keys()),
        index=list(sc_choices.keys()).index(sc_default) if sc_default in sc_choices else 0,
    )

    st.markdown("**Cost items**")
    existing_items = (
        [{"name": i.name, "cost": i.cost, "currency": i.currency, "notes": i.notes} for i in editing.items]
        if editing else []
    )
    items_df = st.data_editor(
        existing_items if existing_items else [{"name": "", "cost": 0.0, "currency": settings.primary_currency, "notes": ""}],
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "name": st.column_config.TextColumn("Item"),
            "cost": st.column_config.NumberColumn("Cost", min_value=0.0, step=100.0),
            "currency": st.column_config.SelectboxColumn("Currency", options=SUPPORTED_CURRENCIES),
            "notes": st.column_config.TextColumn("Notes"),
        },
        key="items_editor",
    )

    st.markdown("**Funding sources**")
    st.caption("`stock`: amount = shares to liquidate.  `property`: amount = fraction sold (0..1).  `cash`: amount = primary-currency cash contribution.")

    asset_options = ["(none)"]
    asset_label_to_id: dict[str, tuple[str, str]] = {}
    for h in stocks:
        label = f"stock | {h.ticker or h.company_name} ({h.id})"
        asset_options.append(label)
        asset_label_to_id[label] = ("stock", h.id)
    for p in properties:
        label = f"property | {p.name} ({p.id})"
        asset_options.append(label)
        asset_label_to_id[label] = ("property", p.id)
    asset_options.append("cash | (primary currency)")
    asset_label_to_id["cash | (primary currency)"] = ("cash", "")

    def _funding_label(fs: FundingSource) -> str:
        if fs.kind == "cash":
            return "cash | (primary currency)"
        if fs.kind == "stock":
            h = next((x for x in stocks if x.id == fs.asset_id), None)
            return f"stock | {h.ticker or h.company_name} ({fs.asset_id})" if h else "(missing)"
        if fs.kind == "property":
            p = next((x for x in properties if x.id == fs.asset_id), None)
            return f"property | {p.name} ({fs.asset_id})" if p else "(missing)"
        return "(none)"

    existing_funding = (
        [{"asset": _funding_label(fs), "amount_or_shares": fs.amount_or_shares} for fs in editing.funding]
        if editing else []
    )
    funding_df = st.data_editor(
        existing_funding if existing_funding else [{"asset": "(none)", "amount_or_shares": 0.0}],
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "asset": st.column_config.SelectboxColumn("Asset", options=asset_options),
            "amount_or_shares": st.column_config.NumberColumn("Amount / shares / fraction", min_value=0.0, step=1.0),
        },
        key="funding_editor",
    )

    submit = st.form_submit_button("Save project", type="primary")
    if submit:
        if target.strip():
            try:
                date.fromisoformat(target.strip())
            except ValueError:
                st.error("Target date must be YYYY-MM-DD.")
                st.stop()

        items = []
        for row in items_df:
            n = (row.get("name") or "").strip()
            c = float(row.get("cost") or 0)
            if n and c > 0:
                items.append(ProjectItem(
                    name=n, cost=c,
                    currency=row.get("currency") or settings.primary_currency,
                    notes=(row.get("notes") or "").strip(),
                ))

        funding = []
        for row in funding_df:
            asset = row.get("asset") or "(none)"
            amt = float(row.get("amount_or_shares") or 0)
            if asset == "(none)" or amt <= 0:
                continue
            kind, aid = asset_label_to_id.get(asset, ("none", ""))
            if kind == "none":
                continue
            funding.append(FundingSource(kind=kind, asset_id=aid or None, amount_or_shares=amt))

        proj = InvestmentProject(
            id=editing.id if editing else InvestmentProject().id,
            name=name.strip(),
            description=desc.strip(),
            target_date=target.strip() or None,
            currency=proj_ccy,
            items=items,
            funding=funding,
            scenario_id=sc_choices[sc_name].id,
        )
        upsert_project(proj)
        st.success(f"Saved project '{proj.name}'.")
        st.rerun()
