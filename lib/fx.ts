import type { Settings } from "./models";

export function convert(amount: number, from: string, to: string, settings: Settings): number {
  if (from === to) return amount;
  const rates = settings.fx_rates;
  const r_from = rates[from];
  const r_to = rates[to];
  if (!r_from || !r_to) return amount;
  const usd = amount / r_from;
  return usd * r_to;
}
