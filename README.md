# Investor

Personal investment tracker, scenario projections, and project evaluation. Mobile-first PWA — installable on iOS and Android home screens.

- **Track** stocks (incl. RSU vesting schedules and double-trigger second-trigger dates) and properties
- **Project** net worth across scenarios with line + stacked-area "sand" charts and allocation pies
- **Evaluate** investment projects (e.g. buy a house + furniture + car) — checks whether your chosen funding sources cover the cost net of tax in a given scenario
- **Storage**: browser localStorage (per-device). Drive sync planned as a follow-up.
- **Demo mode**: full app, populated fake data, no setup needed.

## Stack

Next.js 15 (static export) · React 19 · TypeScript · Tailwind · Recharts · Zod · PWA. **No server, no SSR**, ships as static HTML/JS — runs on GitHub Pages or any static host.

## Live URL

After GitHub Pages is enabled (see below), the app is served at:

> **https://shanearnott.github.io/Investor/**

## Deploy to GitHub Pages — one-time setup

The repo includes a workflow at `.github/workflows/deploy-pages.yml` that builds and deploys on every push to `main`. **You only need to enable Pages once:**

1. Go to https://github.com/shanearnott/Investor/settings/pages
2. Under **Build and deployment** → **Source**, select **GitHub Actions**.
3. Push (or re-run) any commit on `main`. Watch progress at https://github.com/shanearnott/Investor/actions.
4. When the workflow finishes (~2 min), the URL above is live.

That's it. No environment variables, no OAuth setup.

To install on your phone: iOS Safari → **Share → Add to Home Screen**. Android Chrome → menu → **Install app**.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
```

To build the static export and inspect the output:

```bash
npm run build    # outputs to ./out/
```

## Tax model — caveats

Defaults are **indicative top-marginal estimates** per jurisdiction. Override any field on the **Settings** page. **Not tax advice** — verify with a qualified tax adviser before acting on any number this app produces.

Supported jurisdictions: California, Australia, UAE, UK, Singapore, Canada, Germany, New Zealand, Hong Kong, Ireland, US-Federal-Only.

## Property growth data

- **Australia**: bundled suburb seed dataset (`data/aus_suburb_growth.json`) sourced from public Domain quarterly reports (5y CAGR, all dwellings). Refresh by editing the JSON file.
- **United States**: manual entry per property (Zillow ZHVI integration could be added as a static dataset later).
- **Manual override** per property always wins.
- **Per-scenario override** — each scenario can override growth rates per property.

## Roadmap

- [x] Static export to GitHub Pages
- [ ] Client-side Google sign-in (Google Identity Services) + Drive sync, all in the browser, no server
- [ ] Bundled US ZIP-level growth seed dataset

## Disclaimer

This is a personal-use tool. Calculations, especially tax, are simplified and may not match your actual liability. Do not rely on it for filing or for major financial decisions without independent verification.
