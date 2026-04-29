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
