import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as currency using the ISO code (USD, AUD, GBP, ...) as the
 * identifier rather than a locale-dependent symbol. This avoids the en-AU
 * bug where the AUD "$" symbol can collide with other currencies' "$".
 * Always produces one identifier (front or back depending on locale), never
 * both.
 */
export function formatMoney(
  n: number,
  currency: string,
  opts: { fractionDigits?: number } = {},
): string {
  const digits = opts.fractionDigits ?? 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(digits)}`;
  }
}

export function formatNumber(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

/** Compact-format a money value as e.g. "USD 2.1M", "AUD 380K". For
 *  totals where two decimals of precision are noise. Falls back to the
 *  full formatMoney when below the K threshold. */
export function formatMoneyCompact(n: number, currency: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  let value: string;
  if (abs >= 1_000_000_000) value = `${(abs / 1_000_000_000).toFixed(1)}B`;
  else if (abs >= 1_000_000) value = `${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) value = `${(abs / 1_000).toFixed(1)}K`;
  else return formatMoney(n, currency);
  // Strip trailing ".0" so 2.0M reads as 2M.
  value = value.replace(/\.0(?=[KMB]$)/, "");
  return `${sign}${currency} ${value}`;
}

/** Compact-format a plain count as e.g. "2.1M", "380K". */
export function formatNumberCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  let value: string;
  if (abs >= 1_000_000_000) value = `${(abs / 1_000_000_000).toFixed(1)}B`;
  else if (abs >= 1_000_000) value = `${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 10_000) value = `${(abs / 1_000).toFixed(1)}K`;
  else return formatNumber(n);
  value = value.replace(/\.0(?=[KMB]$)/, "");
  return `${sign}${value}`;
}
