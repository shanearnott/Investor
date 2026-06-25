/**
 * Live SOFR feed — pulls the latest overnight SOFR fixing from the NY
 * Fed Markets API. Pure client-side fetch with a 24-hour localStorage
 * cache so we don't hammer the endpoint on every page open.
 *
 * The NY Fed publishes one rate per business day with a one-business-day
 * delay (Monday's fixing posts Tuesday morning). The returned
 * `effective_date` is the date the rate applies to, not when we fetched.
 *
 * Endpoint is CORS-enabled and key-free. If it goes down or the response
 * doesn't parse, fetchLatestSofr resolves to null and the UI silently
 * hides the live-rate chip.
 */

"use client";

const SOFR_URL =
  "https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json";
const CACHE_KEY = "investor:sofr-feed-cache";
const TTL_MS = 24 * 60 * 60 * 1000;

export type SofrSnapshot = {
  rate_pct: number;
  effective_date: string; // YYYY-MM-DD as published by NY Fed
  fetched_at: string; // ISO timestamp client-side
};

function readCache(): SofrSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as SofrSnapshot;
    if (
      typeof cached.rate_pct === "number"
      && typeof cached.effective_date === "string"
      && typeof cached.fetched_at === "string"
    ) {
      return cached;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(snap: SofrSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch {
    /* quota or private mode — ignore */
  }
}

export async function fetchLatestSofr(opts?: { force?: boolean }): Promise<SofrSnapshot | null> {
  if (!opts?.force) {
    const cached = readCache();
    if (cached) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < TTL_MS) return cached;
    }
  }
  try {
    const res = await fetch(SOFR_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      // No credentials; the endpoint is public.
      credentials: "omit",
    });
    if (!res.ok) return readCache();
    const json = (await res.json()) as { refRates?: Array<{ percentRate?: number; effectiveDate?: string }> };
    const first = json?.refRates?.[0];
    if (!first || typeof first.percentRate !== "number" || typeof first.effectiveDate !== "string") {
      return readCache();
    }
    const snap: SofrSnapshot = {
      rate_pct: first.percentRate,
      effective_date: first.effectiveDate,
      fetched_at: new Date().toISOString(),
    };
    writeCache(snap);
    return snap;
  } catch {
    return readCache();
  }
}
