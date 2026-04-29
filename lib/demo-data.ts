/**
 * Demo dataset — used when no user is signed in.
 * Mixes US California RSUs + a public-stock holding with AUS Sydney + SF
 * properties, plus a few scenarios and a sample project.
 */

import { newId, type CollectionsMap } from "./models";

function isoDateOffset(years: number, months = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(15);
  return d.toISOString().slice(0, 10);
}

const stockId = "demo-stock-acme";
const propertyId = "demo-prop-bondi";

export function buildDemoData(): CollectionsMap {
  // Build vesting schedule: 16 quarterly tranches of 250 shares
  const vesting = Array.from({ length: 16 }, (_, i) => ({
    vest_date: isoDateOffset(0, i * 3 - 12), // some past, some future
    shares: 250,
  }));

  return {
    stocks: [
      {
        id: stockId,
        ticker: "ACME",
        company_name: "Acme Robotics Inc",
        equity_type: "RSU",
        currency: "USD",
        jurisdiction: "California",
        current_share_price: 48.5,
        cost_basis_per_share: 22.0,
        shares_owned_outright: 1500,
        vesting_schedule: vesting,
        notes: "Demo: RSUs vesting on the schedule below.",
      },
      {
        id: "demo-stock-msft",
        ticker: "MSFT",
        company_name: "Microsoft Corporation",
        equity_type: "Common Stock",
        currency: "USD",
        jurisdiction: "California",
        current_share_price: 415.0,
        cost_basis_per_share: 280.0,
        shares_owned_outright: 200,
        vesting_schedule: [],
        notes: "Demo: public-stock holding, long-term cap gains eligible.",
      },
    ],
    properties: [
      {
        id: propertyId,
        name: "Bondi apartment",
        address: "12 Curlewis St",
        suburb: "Bondi",
        region: "NSW",
        country: "Australia",
        postcode: "2026",
        purchase_price: 1_100_000,
        purchase_date: isoDateOffset(-4, 0),
        current_value: 1_350_000,
        annual_growth_pct: 5.5,
        mortgage_balance: 620_000,
        currency: "AUD",
        jurisdiction: "Australia",
        notes: "Demo: Sydney apartment.",
      },
      {
        id: "demo-prop-sf",
        name: "San Francisco condo",
        address: "500 Hayes St",
        suburb: "Hayes Valley",
        region: "CA",
        country: "United States",
        postcode: "94102",
        purchase_price: 950_000,
        purchase_date: isoDateOffset(-6, 0),
        current_value: 1_180_000,
        annual_growth_pct: 3.5,
        mortgage_balance: 540_000,
        currency: "USD",
        jurisdiction: "California",
        notes: "Demo: SF condo.",
      },
    ],
    scenarios: [
      {
        id: "demo-sc-base",
        name: "Base case",
        description: "8%/yr stocks, 4%/yr property, 5y horizon, IPO at default date.",
        horizon_years: 5,
        default_stock_growth_pct: 8,
        default_property_growth_pct: 4,
        stock_overrides: {},
        property_overrides: {},
        inflation_pct: 2.5,
      },
      {
        id: "demo-sc-bull",
        name: "Bull case",
        description: "ACME doubles in 2y; property grows 7%.",
        horizon_years: 5,
        default_stock_growth_pct: 14,
        default_property_growth_pct: 7,
        stock_overrides: {
          [stockId]: { annual_price_growth_pct: 30 },
        },
        property_overrides: {},
        inflation_pct: 3,
      },
      {
        id: "demo-sc-bear",
        name: "Bear case",
        description: "ACME flat-lines, property +1%.",
        horizon_years: 5,
        default_stock_growth_pct: 2,
        default_property_growth_pct: 1,
        stock_overrides: {
          [stockId]: {
            annual_price_growth_pct: -5,
          },
        },
        property_overrides: {},
        inflation_pct: 4,
      },
    ],
    projects: [
      {
        id: "demo-proj-house",
        name: "Buy a house in Sydney",
        description: "Demo project: deposit + furniture + car",
        target_date: isoDateOffset(3, 0),
        currency: "AUD",
        jurisdiction: "Australia",
        items: [
          { name: "House deposit (20%)", cost: 600_000, currency: "AUD", notes: "" },
          { name: "Stamp duty + fees", cost: 80_000, currency: "AUD", notes: "" },
          { name: "Furniture", cost: 40_000, currency: "AUD", notes: "" },
          { name: "Car", cost: 50_000, currency: "AUD", notes: "" },
        ],
        funding: [
          { kind: "stock", asset_id: stockId, amount_or_shares: 4000 },
          { kind: "stock", asset_id: "demo-stock-msft", amount_or_shares: 100 },
          { kind: "cash", asset_id: null, amount_or_shares: 50_000 },
        ],
        scenario_id: "demo-sc-base",
      },
    ],
    settings: {
      primary_currency: "USD",
      secondary_currency: "AUD",
      fx_rates: {
        USD: 1.0, AUD: 1.52, GBP: 0.78, AED: 3.67, SGD: 1.34,
        EUR: 0.92, CAD: 1.36, NZD: 1.65, HKD: 7.82,
      },
      default_jurisdiction: "California",
      tax_overrides: {},
      google_oauth_client_id: "",
    },
  };
}

// Stable id helper for new entries inside the app
export { newId };
