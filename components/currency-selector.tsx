"use client";

import { useData } from "@/components/data-provider";
import { Select } from "@/components/ui/input";
import { SUPPORTED_CURRENCIES } from "@/lib/models";

/**
 * Display-currency selector. USD and AUD are surfaced first, then any other
 * supported currencies. The choice persists across sessions (localStorage).
 */
export function CurrencySelector({ label = "Display in" }: { label?: string }) {
  const { displayCurrency, setDisplayCurrency } = useData();
  // Pin USD first, AUD second, then the rest in their declared order
  const ordered = ["USD", "AUD", ...SUPPORTED_CURRENCIES.filter((c) => c !== "USD" && c !== "AUD")];
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <Select
        value={displayCurrency}
        onChange={(e) => setDisplayCurrency(e.target.value)}
        className="h-8 w-24 text-xs"
      >
        {ordered.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    </label>
  );
}

