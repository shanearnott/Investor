"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { newId, RSU_DEFAULT_TAX_RATES, Scenario, ScenarioSchema, SUPPORTED_JURISDICTIONS } from "@/lib/models";
import { cn, formatMoney } from "@/lib/utils";

/** Scroll an inline edit form into view on mount. */
function useScrollIntoViewOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 60);
    return () => clearTimeout(t);
  }, []);
  return ref;
}

function blank(): Scenario {
  return ScenarioSchema.parse({
    id: newId(),
    name: "Base case",
    description: "",
    horizon_years: 5,
    default_stock_growth_pct: 8,
    default_property_growth_pct: 4,
    stock_overrides: {},
    property_overrides: {},
    inflation_pct: 0,
  });
}

export default function ScenariosPage() {
  const { data, setScenarios } = useData();
  const [editing, setEditing] = useState<Scenario | null>(null);

  const save = async (s: Scenario) => {
    const i = data.scenarios.findIndex((x) => x.id === s.id);
    const next = [...data.scenarios];
    if (i >= 0) next[i] = s;
    else next.push(s);
    await setScenarios(next);
    setEditing(null);
  };

  const remove = async (id: string) => {
    await setScenarios(data.scenarios.filter((x) => x.id !== id));
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Scenarios</h1>
        <Button onClick={() => setEditing(blank())}>
          <Plus className="h-4 w-4" /> Add scenario
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Each scenario is a set of growth assumptions. Use them in <b>Projections</b> and <b>Projects</b>.
      </p>

      <div className="grid gap-3">
        {data.scenarios.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No scenarios yet. Try Base / Bear / Bull or "IPO 2027".
            </CardContent>
          </Card>
        ) : (
          data.scenarios.map((s) => (
            <Fragment key={s.id}>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    <CardDescription>
                      {s.horizon_years}y · stocks {s.default_stock_growth_pct.toFixed(1)}%/yr · property{" "}
                      {s.default_property_growth_pct.toFixed(1)}%/yr
                      {s.inflation_pct ? ` · inflation ${s.inflation_pct.toFixed(1)}%` : ""}
                      {` · RSU tax ${s.rsu_tax_jurisdiction} ${s.rsu_tax_rate_pct}%`}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={editing?.id === s.id ? "default" : "outline"}
                      onClick={() => setEditing(editing?.id === s.id ? null : { ...s })}
                    >
                      {editing?.id === s.id ? "Close" : "Edit"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                {s.description ? (
                  <CardContent className="text-xs text-muted-foreground">{s.description}</CardContent>
                ) : null}
              </Card>
              {editing?.id === s.id ? (
                <ScenarioForm
                  key={editing.id}
                  draft={editing}
                  onCancel={() => setEditing(null)}
                  onSave={save}
                />
              ) : null}
            </Fragment>
          ))
        )}
      </div>

      {editing && !data.scenarios.some((s) => s.id === editing.id) ? (
        <ScenarioForm
          key={editing.id}
          draft={editing}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
    </div>
  );
}

function ScenarioForm({ draft, onCancel, onSave }: { draft: Scenario; onCancel: () => void; onSave: (s: Scenario) => Promise<void> }) {
  const { data } = useData();
  const [d, setD] = useState<Scenario>(draft);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useScrollIntoViewOnMount<HTMLDivElement>();

  // Per-year RSU tax mode. On when the scenario already carries year
  // overrides, or when the user explicitly toggles it.
  const [perYearTax, setPerYearTax] = useState<boolean>(
    () => Object.keys(draft.rsu_tax_year_overrides ?? {}).length > 0,
  );
  const setYearRate = (year: number, pct: number | undefined) => {
    setD((p) => {
      const next = { ...(p.rsu_tax_year_overrides ?? {}) };
      if (pct === undefined) delete next[String(year)];
      else next[String(year)] = pct;
      return { ...p, rsu_tax_year_overrides: next };
    });
  };

  // Which per-asset override rows are expanded. Rows that already have an
  // override start expanded; everything else is collapsed to a one-line
  // summary so a scenario that only tweaks the defaults stays compact.
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const id of Object.keys(draft.stock_overrides ?? {})) {
      const ov = draft.stock_overrides[id];
      if (ov && (ov.starting_share_price !== undefined || ov.annual_price_growth_pct !== undefined || ov.target_share_price !== undefined)) {
        init.add(id);
      }
    }
    for (const id of Object.keys(draft.property_overrides ?? {})) {
      if (draft.property_overrides[id]?.annual_growth_pct !== undefined) init.add(id);
    }
    return init;
  });
  const isExpanded = (id: string) => expandedAssets.has(id);
  const expand = (id: string) =>
    setExpandedAssets((prev) => new Set(prev).add(id));
  const collapse = (id: string) =>
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const update = <K extends keyof Scenario>(k: K, v: Scenario[K]) => setD((p) => ({ ...p, [k]: v }));

  const updateStockOv = (
    id: string,
    ov: {
      starting_share_price?: number;
      annual_price_growth_pct?: number;
      target_share_price?: number;
    },
  ) => {
    setD((p) => ({
      ...p,
      stock_overrides: { ...p.stock_overrides, [id]: { ...p.stock_overrides[id], ...ov } },
    }));
  };

  const clearStockField = (
    id: string,
    field: "starting_share_price" | "annual_price_growth_pct" | "target_share_price",
  ) => {
    setD((p) => {
      const cur = { ...(p.stock_overrides[id] ?? {}) };
      delete cur[field];
      return { ...p, stock_overrides: { ...p.stock_overrides, [id]: cur } };
    });
  };

  /** Drop every override field for a stock and collapse it back to default. */
  const resetStock = (id: string) => {
    setD((p) => {
      const next = { ...p.stock_overrides };
      delete next[id];
      return { ...p, stock_overrides: next };
    });
    collapse(id);
  };

  const updatePropOv = (id: string, ov: { annual_growth_pct?: number }) => {
    setD((p) => ({
      ...p,
      property_overrides: { ...p.property_overrides, [id]: { ...p.property_overrides[id], ...ov } },
    }));
  };

  const resetProperty = (id: string) => {
    setD((p) => {
      const next = { ...p.property_overrides };
      delete next[id];
      return { ...p, property_overrides: next };
    });
    collapse(id);
  };

  /** When the user picks a new jurisdiction, pre-fill the rate from the
   *  per-jurisdiction default — but only overwrite the rate if there's a
   *  default for that jurisdiction; otherwise leave the prior rate alone
   *  so they don't lose a custom number. */
  const setRsuJurisdiction = (j: typeof SUPPORTED_JURISDICTIONS[number]) => {
    setD((p) => {
      const def = RSU_DEFAULT_TAX_RATES[j];
      return {
        ...p,
        rsu_tax_jurisdiction: j,
        rsu_tax_rate_pct: def !== undefined ? def : p.rsu_tax_rate_pct,
      };
    });
  };

  const submit = async () => {
    setError(null);
    const parsed = ScenarioSchema.safeParse(d);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    await onSave(parsed.data);
  };

  return (
    <Card ref={cardRef} className="scroll-mt-24 ring-2 ring-primary/20">
      <CardHeader>
        <CardTitle>{draft.name ? `Edit "${draft.name}"` : "Add scenario"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Name">
            <Input value={d.name} onChange={(e) => update("name", e.target.value)} />
          </Field>
          <Field label="Horizon" hint="How far into the future to project">
            <SuffixedInput
              suffix="years"
              type="number"
              min={1}
              max={50}
              value={d.horizon_years}
              onChange={(e) => update("horizon_years", Number(e.target.value))}
            />
          </Field>
          <Field label="Inflation" hint="Used for the optional real-value view">
            <SuffixedInput
              suffix="%/yr"
              type="number"
              step="0.1"
              value={d.inflation_pct}
              onChange={(e) => update("inflation_pct", Number(e.target.value))}
            />
          </Field>
          <Field label="Default stock growth" hint="Applied to stocks without an override below">
            <SuffixedInput
              suffix="%/yr"
              type="number"
              step="0.5"
              value={d.default_stock_growth_pct}
              onChange={(e) => update("default_stock_growth_pct", Number(e.target.value))}
            />
          </Field>
          <Field label="Default property growth" hint="Applied to properties without an override below">
            <SuffixedInput
              suffix="%/yr"
              type="number"
              step="0.5"
              value={d.default_property_growth_pct}
              onChange={(e) => update("default_property_growth_pct", Number(e.target.value))}
            />
          </Field>
        </div>
        <Field label="Description">
          <Textarea
            value={d.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder='e.g. "Bull case: ACME doubles by IPO + 7%/yr property"'
          />
        </Field>

        {data.stocks.length > 0 ? (
          <div className="space-y-2">
            <Label>Per-stock overrides</Label>
            <p className="text-[11px] text-muted-foreground">
              Set a different growth % for individual stocks. Leave at the default to inherit.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Set a growth rate, OR a target share price at +{d.horizon_years}y — whichever
              fits how you think. Target price wins when both are set.
            </p>
            <div className="space-y-2">
              {data.stocks.map((h) => {
                const ov = d.stock_overrides[h.id] ?? {};
                const usingStart = ov.starting_share_price !== undefined && ov.starting_share_price > 0;
                const startPrice = usingStart
                  ? (ov.starting_share_price ?? h.current_share_price)
                  : h.current_share_price;
                const usingTarget = ov.target_share_price !== undefined && ov.target_share_price > 0;
                const usingRate = ov.annual_price_growth_pct !== undefined && !usingTarget;
                // Implied annual growth from target, computed against the
                // *effective* starting price (override-aware)
                const impliedFromTarget =
                  usingTarget && startPrice > 0 && d.horizon_years > 0
                    ? (Math.pow((ov.target_share_price ?? 0) / startPrice, 1 / d.horizon_years) - 1) * 100
                    : null;
                const effectiveRate = usingTarget
                  ? impliedFromTarget ?? d.default_stock_growth_pct
                  : ov.annual_price_growth_pct ?? d.default_stock_growth_pct;
                const hasOverride =
                  ov.starting_share_price !== undefined ||
                  ov.annual_price_growth_pct !== undefined ||
                  ov.target_share_price !== undefined;
                const open = isExpanded(h.id);
                return (
                  <div key={h.id} className="rounded-md border p-2 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm">
                        <div className="font-medium">{h.ticker || h.company_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {open ? (
                            <>
                              actual {formatMoney(h.current_share_price, h.currency, { fractionDigits: 2 })}/sh
                              {usingStart ? (
                                <> · scenario starts at <b>{formatMoney(startPrice, h.currency, { fractionDigits: 2 })}</b></>
                              ) : null}
                            </>
                          ) : hasOverride ? (
                            <>
                              {usingStart ? (
                                <>start {formatMoney(startPrice, h.currency, { fractionDigits: 2 })} · </>
                              ) : null}
                              <b>{effectiveRate.toFixed(1)}%/yr</b>
                              {usingTarget ? (
                                <> (target {formatMoney(ov.target_share_price ?? 0, h.currency, { fractionDigits: 2 })})</>
                              ) : null}
                            </>
                          ) : (
                            <>using default {d.default_stock_growth_pct}%/yr</>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                        onClick={() => {
                          if (open) {
                            if (hasOverride) resetStock(h.id);
                            else collapse(h.id);
                          } else {
                            expand(h.id);
                          }
                        }}
                      >
                        {open ? (hasOverride ? "Reset to default" : "Done") : "Customise"}
                      </button>
                    </div>
                    {open ? (
                      <>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <Field
                            label="Starting price (today)"
                            hint={`What if today's ${h.ticker || "share"} price was X. Blank = use actual ${formatMoney(h.current_share_price, h.currency, { fractionDigits: 2 })}.`}
                          >
                            <SuffixedInput
                              suffix={h.currency}
                              type="number"
                              step="0.01"
                              min={0}
                              value={ov.starting_share_price ?? ""}
                              placeholder={h.current_share_price.toFixed(2)}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "") clearStockField(h.id, "starting_share_price");
                                else updateStockOv(h.id, { starting_share_price: Number(val) });
                              }}
                            />
                          </Field>
                          <Field label="Growth rate" hint={`Default ${d.default_stock_growth_pct}%/yr`}>
                            <SuffixedInput
                              suffix="%/yr"
                              type="number"
                              step="0.5"
                              value={ov.annual_price_growth_pct ?? d.default_stock_growth_pct}
                              disabled={usingTarget}
                              onChange={(e) =>
                                updateStockOv(h.id, { annual_price_growth_pct: Number(e.target.value) })
                              }
                            />
                          </Field>
                          <Field
                            label={`Target at +${d.horizon_years}y`}
                            hint={
                              h.currency
                                ? `Implies a growth from the starting price. Blank = use the rate.`
                                : "Blank = use the rate."
                            }
                          >
                            <SuffixedInput
                              suffix={h.currency}
                              type="number"
                              step="0.01"
                              min={0}
                              value={ov.target_share_price ?? ""}
                              placeholder="e.g. 200"
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "") clearStockField(h.id, "target_share_price");
                                else updateStockOv(h.id, { target_share_price: Number(val) });
                              }}
                            />
                          </Field>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {usingTarget ? (
                            <>
                              {usingStart ? (
                                <>From <b>{formatMoney(startPrice, h.currency, { fractionDigits: 2 })}</b> → </>
                              ) : null}
                              target {formatMoney(ov.target_share_price ?? 0, h.currency, { fractionDigits: 2 })} → implied{" "}
                              <b>{effectiveRate.toFixed(1)}%/yr</b>
                            </>
                          ) : usingRate ? (
                            <>
                              {usingStart ? (
                                <>Starting at <b>{formatMoney(startPrice, h.currency, { fractionDigits: 2 })}</b>, </>
                              ) : null}
                              using <b>{effectiveRate.toFixed(1)}%/yr</b>
                            </>
                          ) : (
                            <>
                              {usingStart ? (
                                <>Starting at <b>{formatMoney(startPrice, h.currency, { fractionDigits: 2 })}</b>, </>
                              ) : null}
                              using default {d.default_stock_growth_pct}%/yr
                            </>
                          )}
                        </p>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {data.properties.length > 0 ? (
          <div className="space-y-2">
            <Label>Per-property overrides</Label>
            <p className="text-[11px] text-muted-foreground">
              Override the growth rate for individual properties. Leave blank to use the default.
            </p>
            <div className="space-y-2">
              {data.properties.map((p) => {
                const ov = d.property_overrides[p.id] ?? {};
                const rate = ov.annual_growth_pct ?? d.default_property_growth_pct;
                const usingOverride = ov.annual_growth_pct !== undefined;
                const open = isExpanded(p.id);
                return (
                  <div key={p.id} className="rounded-md border p-2 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.suburb}, {p.region}
                          {open ? (
                            <> · current {formatMoney(p.current_value, p.currency)}</>
                          ) : usingOverride ? (
                            <> · <b>{rate.toFixed(1)}%/yr</b></>
                          ) : (
                            <> · using default {d.default_property_growth_pct}%/yr</>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                        onClick={() => {
                          if (open) {
                            if (usingOverride) resetProperty(p.id);
                            else collapse(p.id);
                          } else {
                            expand(p.id);
                          }
                        }}
                      >
                        {open ? (usingOverride ? "Reset to default" : "Done") : "Customise"}
                      </button>
                    </div>
                    {open ? (
                      <div>
                        <SuffixedInput
                          suffix="%/yr"
                          type="number"
                          step="0.5"
                          value={rate}
                          onChange={(e) => updatePropOv(p.id, { annual_growth_pct: Number(e.target.value) })}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {usingOverride
                            ? `Overrides default ${d.default_property_growth_pct}%/yr`
                            : `Using default ${d.default_property_growth_pct}%/yr`}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>RSU tax jurisdiction</Label>
          <p className="text-[11px] text-muted-foreground">
            Models income tax due at vest as a single jurisdiction-wide rate
            applied to <i>all</i> RSU holdings in this scenario — useful for
            &quot;what if I moved to UAE&quot; style modelling. Non-RSU equity
            is unaffected.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Jurisdiction" hint="Picking a jurisdiction pre-fills the rate; you can edit after.">
              <Select
                value={d.rsu_tax_jurisdiction}
                onChange={(e) => setRsuJurisdiction(e.target.value as typeof SUPPORTED_JURISDICTIONS[number])}
              >
                {SUPPORTED_JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>
                    {j}{RSU_DEFAULT_TAX_RATES[j] !== undefined ? ` (${RSU_DEFAULT_TAX_RATES[j]}%)` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Flat tax rate" hint="Default rate for any year without a per-year override.">
              <SuffixedInput
                suffix="%"
                type="number"
                step="0.5"
                min={0}
                max={100}
                value={d.rsu_tax_rate_pct}
                onChange={(e) => update("rsu_tax_rate_pct", Number(e.target.value))}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={perYearTax}
              onChange={(e) => {
                const on = e.target.checked;
                setPerYearTax(on);
                if (!on) {
                  // Leaving per-year mode discards the year overrides so the
                  // scenario goes back to pure flat-rate behaviour.
                  setD((p) => ({ ...p, rsu_tax_year_overrides: {} }));
                }
              }}
            />
            <span>Use per-year rates (shares vesting in a year are taxed at that year&apos;s rate)</span>
          </label>

          {perYearTax ? (
            <div className="rounded-md border p-2 space-y-2">
              <p className="text-[11px] text-muted-foreground">
                One row per year from now to the horizon. A year left at the flat
                rate isn&apos;t stored as an override; set it to model a relocation
                (e.g. set 2028 onward to 0% for UAE). Shares vesting that calendar
                year use that year&apos;s rate.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Array.from({ length: d.horizon_years + 1 }, (_, i) => {
                  const year = new Date().getUTCFullYear() + i;
                  const ov = d.rsu_tax_year_overrides?.[String(year)];
                  const effective = ov !== undefined ? ov : d.rsu_tax_rate_pct;
                  return (
                    <div key={year} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{year}</span>
                        {ov !== undefined ? (
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground hover:underline"
                            onClick={() => setYearRate(year, undefined)}
                          >
                            use flat
                          </button>
                        ) : null}
                      </div>
                      <SuffixedInput
                        suffix="%"
                        type="number"
                        step="0.5"
                        min={0}
                        max={100}
                        value={effective}
                        className={ov !== undefined ? "border-primary" : ""}
                        onChange={(e) => setYearRate(year, Number(e.target.value))}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
      <div className="flex justify-end gap-2 p-4 sm:p-6 pt-0">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit}>Save</Button>
      </div>
    </Card>
  );
}

function SuffixedInput({
  suffix,
  className,
  ...props
}: { suffix: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Input className={cn("pr-12", className)} {...props} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
        {suffix}
      </span>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
