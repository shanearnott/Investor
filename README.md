# Investor

Personal investment tracker, scenario projections, and project evaluation. Mobile-first PWA — installable on iOS and Android home screens.

- **Track** stocks (incl. RSU vesting schedules and double-trigger second-trigger dates) and properties
- **Project** net worth across scenarios with line + stacked-area "sand" charts and allocation pies
- **Evaluate** investment projects (e.g. buy a house + furniture + car) — checks whether your chosen funding sources cover the cost net of tax in a given scenario
- **Storage**: your data lives in your own Google Drive (folder `Investor App`)
- **Auth**: Sign in with Google
- **Demo mode**: full app, fake data, stored in browser localStorage — no Google setup needed

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind · Recharts · Auth.js v5 · Google Drive REST · Zod · PWA.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in or leave blank to use demo mode only
npm run dev                   # http://localhost:3000
```

If `.env.local` is blank, the app boots in demo mode (no sign-in possible). Click **Try with demo data** on the home page.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Import Project** → select the repo.
3. **Environment variables** (Production + Preview):
   - `AUTH_SECRET` — generate with `openssl rand -base64 32`
   - `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` — see Google setup below
4. Deploy.

## Google OAuth setup (one-time)

You create your own Google Cloud OAuth client so the app can sign you in to your own Google account. The app only ever sees files it creates in your Drive (it uses the `drive.file` scope, not full-Drive access).

1. Go to https://console.cloud.google.com/apis/credentials
2. **Create credentials** → **OAuth client ID** → **Web application**
3. Add **Authorized redirect URIs**:
   - `https://<your-vercel-domain>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (for local dev)
4. Under **OAuth consent screen**:
   - Add scope `https://www.googleapis.com/auth/drive.file`
   - Add yourself as a **test user** (or publish the app — it stays restricted-scope)
5. Copy the Client ID and Client Secret into Vercel env vars.

That's it. After signing in, the app creates a folder `Investor App` in your Drive and saves five JSON files there.

## How storage works

| Mode | Backend | Where data lives |
|------|---------|------------------|
| Signed in | Google Drive (`drive.file` scope) | `My Drive/Investor App/{stocks,properties,scenarios,projects,settings}.json` |
| Demo mode | Browser localStorage | Your browser only |

When you sign in, the app reads existing files from your Drive (or shows an empty state if none). Writes are atomic per-collection.

## Tax model — caveats

Defaults are **indicative top-marginal estimates** per jurisdiction. Override any field on the **Settings** page. **Not tax advice** — verify with a qualified tax adviser before acting on any number this app produces.

Supported jurisdictions: California, Australia, UAE, UK, Singapore, Canada, Germany, New Zealand, Hong Kong, Ireland, US-Federal-Only.

## Property growth data

- **Australia**: bundled suburb seed dataset (`data/aus_suburb_growth.json`) sourced from public Domain quarterly reports (5y CAGR, all dwellings). Refresh by editing the JSON file.
- **United States**: manual entry per property (Zillow ZHVI integration left as a follow-up — would need a serverless route to fetch the public CSV).
- **Manual override** per property always wins.
- **Per-scenario override** — each scenario can override growth rates per property.

## PWA / install on phone

- iOS Safari: tap **Share** → **Add to Home Screen**.
- Android Chrome: tap menu → **Install app** / **Add to Home Screen**.

The app runs full-screen, has its own icon, and remembers your sign-in.

## Disclaimer

This is a personal-use tool. Calculations, especially tax, are simplified and may not match your actual liability. Do not rely on it for filing or for major financial decisions without independent verification.
