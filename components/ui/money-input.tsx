"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A money / large-number input that comma-formats the displayed value
 * while the field is blurred (so `2,000,000` reads cleanly) and exposes
 * the raw digits while focused (so the cursor doesn't jump as commas
 * shift positions mid-edit).
 *
 * The caller stores a plain `number` in state — empty input or a lone
 * "." map to 0 to keep the underlying state numeric. `suffix` is the
 * small right-aligned label (default "$"); pass a currency code for
 * non-USD fields, or null to render no suffix.
 */
type BaseProps = {
  suffix?: string | null;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;

type RequiredProps = BaseProps & {
  value: number;
  onChange: (n: number) => void;
  allowEmpty?: false;
};

type OptionalProps = BaseProps & {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  /** When true, blank → undefined (not 0). */
  allowEmpty: true;
};

export function MoneyInput(props: RequiredProps | OptionalProps) {
  const { suffix = "$", className, value, onChange, allowEmpty, ...rest } = props;
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => (value === undefined ? "" : String(value)));
  useEffect(() => {
    if (!focused) setDraft(value === undefined ? "" : String(value));
  }, [value, focused]);
  const formatted =
    value === undefined ? "" : Number.isFinite(value) ? value.toLocaleString("en-US") : "";
  const padRight = suffix && suffix.length > 1 ? "pr-12" : "pr-6";
  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="decimal"
        className={cn(padRight, className)}
        value={focused ? draft : formatted}
        onFocus={() => {
          setFocused(true);
          setDraft(value === undefined ? "" : String(value));
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/,/g, "").replace(/[^0-9.]/g, "");
          setDraft(cleaned);
          if (cleaned === "" || cleaned === ".") {
            if (allowEmpty) {
              (onChange as (n: number | undefined) => void)(undefined);
            } else {
              (onChange as (n: number) => void)(0);
            }
            return;
          }
          const n = Number(cleaned);
          if (Number.isFinite(n)) {
            (onChange as (n: number) => void)(n);
          }
        }}
        {...rest}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
