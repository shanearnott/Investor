/**
 * Property growth lookup. Bundled AUS suburb seed dataset; manual fallback per property.
 * (Zillow ZHVI provider could be added as a serverless route later.)
 */

import ausSeed from "@/data/aus_suburb_growth.json";

type AusSeed = {
  suburbs: Record<string, number>;
  fallback_by_capital: Record<string, number>;
  national_default: number;
};

const seed = ausSeed as AusSeed;

export function lookupGrowthRate(args: {
  country: string;
  region: string;
  suburb: string;
  postcode: string;
  fallback_pct: number;
}): { rate: number; source: string } {
  const country = (args.country || "").toLowerCase();
  if (country === "australia" || country === "aus" || country === "au") {
    if (args.region && args.suburb) {
      for (const [key, val] of Object.entries(seed.suburbs)) {
        const parts = key.split("|");
        if (
          parts.length === 3 &&
          parts[1].toUpperCase() === args.region.toUpperCase() &&
          parts[2].toLowerCase() === args.suburb.toLowerCase()
        ) {
          return { rate: val, source: "AUS suburb seed" };
        }
      }
    }
    if (args.region && seed.fallback_by_capital[args.region.toUpperCase()] !== undefined) {
      return {
        rate: seed.fallback_by_capital[args.region.toUpperCase()],
        source: "AUS state default",
      };
    }
    return { rate: seed.national_default, source: "AUS national default" };
  }
  return { rate: args.fallback_pct, source: "manual" };
}
