import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(
  n: number,
  currency: string,
  opts: { fractionDigits?: number } = {},
): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: opts.fractionDigits ?? 0,
      maximumFractionDigits: opts.fractionDigits ?? 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(opts.fractionDigits ?? 0)}`;
  }
}

export function formatNumber(n: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}
