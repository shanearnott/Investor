"""Investments page: add/edit/delete stocks and properties."""

from __future__ import annotations

from datetime import date

import streamlit as st

from investor.models import (
    EQUITY_TYPES,
    Property,
    StockHolding,
    SUPPORTED_CURRENCIES,
    SUPPORTED_JURISDICTIONS,
    VestingTranche,
)
from investor.storage import (
    delete_property,
    delete_stock,
    load_properties,
    load_settings,
    load_stocks,
    upsert_property,
    upsert_stock,
)
from investor.growth import GrowthRateService

st.set_page_config(page_title="Investments · Investor", page_icon="📈", layout="wide")
st.title("Investments")

settings = load_settings()
growth_service = GrowthRateService()

tab_stocks, tab_props = st.tabs(["📊 Stocks & Equity", "🏠 Properties"])


# ---------- Stocks ----------

with tab_stocks:
    st.subheader("Existing holdings")
    stocks = load_stocks()
    if stocks:
        for h in stocks:
            with st.expander(
                f"**{h.ticker or h.company_name or '(unnamed)'}** · {h.equity_type} · "
                f"{h.total_granted_shares():,.0f} sh @ {h.current_share_price:,.2f} {h.currency}",
                expanded=False,
            ):
                st.write(f"**Jurisdiction:** {h.jurisdiction}  |  **Cost basis/share:** {h.cost_basis_per_share:.2f} {h.currency}")
                st.write(f"**Vested today:** {h.vested_shares_at(date.today()):,.0f} sh  |  "
                         f"**Granted total:** {h.total_granted_shares():,.0f} sh")
                if h.equity_type == "RSU (double trigger)":
                    st.write(f"**Second trigger date:** {h.second_trigger_date or '— not set —'}")
                if h.vesting_schedule:
                    sched = [{"vest_date": t.vest_date, "shares": t.shares} for t in h.vesting_schedule]
                    st.dataframe(sched, use_container_width=True, hide_index=True)
                if h.notes:
                    st.caption(h.notes)
                if st.button("Delete", key=f"del_stock_{h.id}", type="secondary"):
                    delete_stock(h.id)
                    st.rerun()
    else:
        st.info("No stocks yet. Add one below.")

    st.divider()
    st.subheader("Add or update a stock holding")

    edit_id = st.selectbox(
        "Edit existing (or leave at 'New' to add)",
        options=["New"] + [f"{s.ticker or s.company_name} ({s.id})" for s in stocks],
        key="stock_edit_select",
    )
    editing: StockHolding | None = None
    if edit_id != "New":
        sid = edit_id.split("(")[-1].rstrip(")")
        editing = next((s for s in stocks if s.id == sid), None)

    with st.form("stock_form", clear_on_submit=False):
        c1, c2, c3 = st.columns(3)
        ticker = c1.text_input("Ticker", value=editing.ticker if editing else "")
        company = c2.text_input("Company name", value=editing.company_name if editing else "")
        equity_type = c3.selectbox(
            "Equity type",
            options=EQUITY_TYPES,
            index=EQUITY_TYPES.index(editing.equity_type) if editing else 0,
        )

        c1, c2, c3 = st.columns(3)
        currency = c1.selectbox(
            "Currency",
            options=SUPPORTED_CURRENCIES,
            index=SUPPORTED_CURRENCIES.index(editing.currency) if editing else 0,
        )
        jurisdiction = c2.selectbox(
            "Jurisdiction (tax)",
            options=SUPPORTED_JURISDICTIONS,
            index=SUPPORTED_JURISDICTIONS.index(editing.jurisdiction) if editing else SUPPORTED_JURISDICTIONS.index(settings.default_jurisdiction),
        )
        current_price = c3.number_input(
            "Current share price",
            min_value=0.0,
            step=0.01,
            value=float(editing.current_share_price) if editing else 0.0,
            format="%.4f",
        )

        c1, c2, c3 = st.columns(3)
        cost_basis = c1.number_input(
            "Cost basis per share (avg)",
            min_value=0.0,
            step=0.01,
            value=float(editing.cost_basis_per_share) if editing else 0.0,
            format="%.4f",
            help="Used for tax calculation on sale. For RSUs taxed at vest, set this to your vest price.",
        )
        shares_outright = c2.number_input(
            "Shares owned outright (already vested)",
            min_value=0.0,
            step=1.0,
            value=float(editing.shares_owned_outright) if editing else 0.0,
        )
        second_trigger = c3.text_input(
            "Second trigger date (YYYY-MM-DD, RSU double-trigger only)",
            value=editing.second_trigger_date or "" if editing else "",
            help="Estimated date IPO or liquidity event occurs. Required for double-trigger RSUs to count toward liquid net worth.",
        )

        st.markdown("**Vesting schedule** (one row per tranche)")
        existing_sched = (
            [{"vest_date": t.vest_date, "shares": t.shares} for t in editing.vesting_schedule]
            if editing else []
        )
        sched_df = st.data_editor(
            existing_sched if existing_sched else [{"vest_date": "", "shares": 0.0}],
            num_rows="dynamic",
            use_container_width=True,
            key="vest_sched_editor",
            column_config={
                "vest_date": st.column_config.TextColumn("Vest date (YYYY-MM-DD)"),
                "shares": st.column_config.NumberColumn("Shares", min_value=0.0, step=1.0),
            },
        )

        notes = st.text_area("Notes", value=editing.notes if editing else "")

        submit = st.form_submit_button("Save", type="primary")
        if submit:
            tranches = []
            for row in sched_df:
                vd = (row.get("vest_date") or "").strip()
                sh = float(row.get("shares") or 0)
                if vd and sh > 0:
                    try:
                        date.fromisoformat(vd)
                        tranches.append(VestingTranche(vest_date=vd, shares=sh))
                    except ValueError:
                        st.warning(f"Skipping invalid vest_date: {vd!r}")

            second_trigger_clean = second_trigger.strip() or None
            if second_trigger_clean:
                try:
                    date.fromisoformat(second_trigger_clean)
                except ValueError:
                    st.error("Second trigger date must be YYYY-MM-DD.")
                    st.stop()

            holding = StockHolding(
                id=editing.id if editing else StockHolding().id,
                ticker=ticker.strip().upper(),
                company_name=company.strip(),
                equity_type=equity_type,
                currency=currency,
                jurisdiction=jurisdiction,
                current_share_price=current_price,
                cost_basis_per_share=cost_basis,
                shares_owned_outright=shares_outright,
                vesting_schedule=tranches,
                second_trigger_date=second_trigger_clean,
                notes=notes.strip(),
            )
            upsert_stock(holding)
            st.success(f"Saved {holding.ticker or holding.company_name}.")
            st.rerun()


# ---------- Properties ----------

with tab_props:
    st.subheader("Existing properties")
    props = load_properties()
    if props:
        for p in props:
            with st.expander(
                f"**{p.name}** · {p.suburb}, {p.region}, {p.country} · "
                f"current value {p.current_value:,.0f} {p.currency}",
                expanded=False,
            ):
                st.write(f"**Address:** {p.address}  |  **Postcode:** {p.postcode}")
                st.write(f"**Purchase:** {p.purchase_price:,.0f} {p.currency} on {p.purchase_date or '—'}")
                st.write(f"**Mortgage:** {p.mortgage_balance:,.0f} {p.currency}  |  "
                         f"**Equity:** {p.equity():,.0f} {p.currency}")
                # Show resolved growth rate
                rate, src = growth_service.lookup(
                    country=p.country, region=p.region, suburb=p.suburb,
                    postcode=p.postcode, fallback_pct=p.annual_growth_pct,
                )
                st.write(f"**Annual growth:** {rate:.2f}% (source: `{src}`; manual override on this property: {p.annual_growth_pct:.2f}%)")
                if p.notes:
                    st.caption(p.notes)
                if st.button("Delete", key=f"del_prop_{p.id}", type="secondary"):
                    delete_property(p.id)
                    st.rerun()
    else:
        st.info("No properties yet. Add one below.")

    st.divider()
    st.subheader("Add or update a property")

    edit_id = st.selectbox(
        "Edit existing (or leave at 'New' to add)",
        options=["New"] + [f"{p.name} ({p.id})" for p in props],
        key="prop_edit_select",
    )
    editing_p: Property | None = None
    if edit_id != "New":
        pid = edit_id.split("(")[-1].rstrip(")")
        editing_p = next((p for p in props if p.id == pid), None)

    with st.form("property_form", clear_on_submit=False):
        c1, c2, c3 = st.columns(3)
        name = c1.text_input("Name (e.g. 'Sydney apartment')", value=editing_p.name if editing_p else "")
        country = c2.selectbox(
            "Country",
            options=["United States", "Australia", "United Kingdom", "Singapore", "United Arab Emirates", "Other"],
            index=(
                ["United States", "Australia", "United Kingdom", "Singapore", "United Arab Emirates", "Other"].index(editing_p.country)
                if editing_p and editing_p.country in ["United States", "Australia", "United Kingdom", "Singapore", "United Arab Emirates", "Other"]
                else 0
            ),
        )
        region = c3.text_input(
            "State / region (e.g. CA, NSW)",
            value=editing_p.region if editing_p else "",
        )

        c1, c2, c3 = st.columns(3)
        suburb = c1.text_input("Suburb / city", value=editing_p.suburb if editing_p else "")
        postcode = c2.text_input("Postcode / ZIP", value=editing_p.postcode if editing_p else "")
        address = c3.text_input("Street address (optional)", value=editing_p.address if editing_p else "")

        c1, c2, c3 = st.columns(3)
        currency = c1.selectbox(
            "Currency",
            options=SUPPORTED_CURRENCIES,
            index=SUPPORTED_CURRENCIES.index(editing_p.currency) if editing_p else 0,
        )
        jurisdiction = c2.selectbox(
            "Jurisdiction (tax)",
            options=SUPPORTED_JURISDICTIONS,
            index=SUPPORTED_JURISDICTIONS.index(editing_p.jurisdiction) if editing_p else SUPPORTED_JURISDICTIONS.index(settings.default_jurisdiction),
        )
        purchase_date = c3.text_input(
            "Purchase date (YYYY-MM-DD)",
            value=(editing_p.purchase_date or "") if editing_p else "",
        )

        c1, c2, c3, c4 = st.columns(4)
        purchase_price = c1.number_input("Purchase price", min_value=0.0, step=1000.0,
                                          value=float(editing_p.purchase_price) if editing_p else 0.0)
        current_value = c2.number_input("Current value", min_value=0.0, step=1000.0,
                                         value=float(editing_p.current_value) if editing_p else 0.0)
        mortgage = c3.number_input("Mortgage balance", min_value=0.0, step=1000.0,
                                    value=float(editing_p.mortgage_balance) if editing_p else 0.0)
        manual_growth = c4.number_input(
            "Manual annual growth %% (fallback)",
            value=float(editing_p.annual_growth_pct) if editing_p else 4.0,
            step=0.1,
            help="Used if no provider data is found for this suburb.",
        )

        # Live preview of resolved growth rate
        if suburb or postcode:
            preview_rate, preview_src = growth_service.lookup(
                country=country, region=region, suburb=suburb, postcode=postcode, fallback_pct=manual_growth,
            )
            st.caption(f"📈 Resolved growth rate: **{preview_rate:.2f}%/yr** · source: `{preview_src}`")

        notes = st.text_area("Notes", value=editing_p.notes if editing_p else "")

        submit = st.form_submit_button("Save", type="primary")
        if submit:
            if purchase_date.strip():
                try:
                    date.fromisoformat(purchase_date.strip())
                except ValueError:
                    st.error("Purchase date must be YYYY-MM-DD.")
                    st.stop()

            prop = Property(
                id=editing_p.id if editing_p else Property().id,
                name=name.strip(),
                address=address.strip(),
                suburb=suburb.strip(),
                region=region.strip(),
                country=country,
                postcode=postcode.strip(),
                purchase_price=purchase_price,
                purchase_date=purchase_date.strip() or None,
                current_value=current_value,
                annual_growth_pct=manual_growth,
                mortgage_balance=mortgage,
                currency=currency,
                jurisdiction=jurisdiction,
                notes=notes.strip(),
            )
            upsert_property(prop)
            st.success(f"Saved {prop.name}.")
            st.rerun()
