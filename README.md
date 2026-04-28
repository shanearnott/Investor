# Investor

Personal investment tracker · scenario projections · investment project evaluation.

A local Streamlit app that:
- tracks **stocks** (incl. RSU vesting schedules and double-trigger / second-trigger dates) and **properties**
- projects **net worth over time** under saved scenarios (line + stacked-area "sand" charts, allocation pies)
- evaluates **investment projects** (e.g. buy a house + furniture + car) — checking whether your chosen funding sources cover the cost **after tax** at the target date in a chosen scenario

All data is saved as JSON under `data/`.

## Quick start

```bash
pip install -r requirements.txt
streamlit run app.py
```

Then open the link Streamlit prints (usually http://localhost:8501).

## Pages

1. **Investments** — add/edit stocks (with vesting schedules, second-trigger date) and properties (suburb, postcode, mortgage). Auto-resolves annual growth from Zillow ZHVI (US ZIP) or the bundled AUS suburb seed dataset; manual override always available.
2. **Scenarios** — define future scenarios with default + per-asset growth overrides, IPO/second-trigger date overrides, and inflation. Save and reuse.
3. **Projections** — net worth over time (line, stacked-area "sand"), per-asset breakdown, current-vs-future allocation pies, real-value view.
4. **Projects** — model a multi-item project with funding sources (stock liquidation / property sale / cash). Evaluates against any scenario, computes tax per the holding's jurisdiction, reports surplus or shortfall.
5. **Settings** — primary/secondary currency, FX rates, tax overrides per jurisdiction, refresh growth-rate caches.

## Tax model

Defaults are **indicative top-marginal estimates** per jurisdiction (California, Australia, UAE, UK, Singapore, Canada, Germany, NZ, Hong Kong, Ireland, US-Federal-only). Override any field on the Settings page. **Not tax advice** — verify with a qualified tax adviser before acting on any number this app produces.

Stock sale tax model:
- gain = (sale price − cost basis) × shares
- if jurisdiction has a CGT discount (AUS 50%, CAN 50%) and held ≥ threshold: gain × (1 − discount) × ordinary rate
- else: gain × (long-term rate if held ≥ threshold else short-term rate)

Property sale tax model:
- gain = sale price − cost basis
- primary-residence exemption available (toggle per jurisdiction)
- otherwise: discount applied if jurisdiction supports it; else gain × property CGT rate

## Growth-rate sources

- **US**: Zillow ZHVI ZIP-level CSV (free public). Cached under `data/cache/`. Refresh via Settings.
- **AUS**: Bundled seed dataset in `data/seed/aus_suburb_growth.json` — populated from public Domain quarterly reports (5y CAGR, all dwellings). Refresh manually by editing the JSON or extending the provider.
- **Fallback**: per-property manual `annual_growth_pct`.
- **Per-scenario override**: each scenario can override growth rates per property.

## Data files

- `data/stocks.json`
- `data/properties.json`
- `data/scenarios.json`
- `data/projects.json`
- `data/settings.json`
- `data/cache/zillow_zhvi_zip.csv` (downloaded on refresh)
- `data/seed/aus_suburb_growth.json` (bundled)

You can override the data directory with `INVESTOR_DATA_DIR=/path/to/dir streamlit run app.py`.

## Disclaimer

This is a personal-use tool. Calculations, especially tax, are simplified and may not match your actual liability. Do not rely on it for filing or for major financial decisions without independent verification.
