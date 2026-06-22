"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { defaultSaleTaxRate, newId, RSU_DEFAULT_TAX_RATES, Scenario, ScenarioSchema, SUPPORTED_JURISDICTIONS } from "@/lib/models";
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
  const [adding, setAdding] = useState<boolean>(false);
  const [cloneSourceId, setCloneSourceId] = useState<string>("");

  const startAdd = () => {
    // No existing scenarios → skip the dialog, start blank.
    if (data.scenarios.length === 0) {
      setEditing(blank());
      return;
    }
    setCloneSourceId(data.scenarios[0]?.id ?? "");
    setAdding(true);
  };
  const confirmAddBlank = () => {
    setAdding(false);
    setEditing(blank());
  };
  const confirmAddClone = () => {
    const src = data.scenarios.find((s) => s.id === cloneSourceId);
    if (!src) {
      setAdding(false);
      return;
    }
    // Fresh ids on the parent + every nested release/sell, and remap
    // sell.release_ref onto the new release ids so the clone is fully
    // independent of the source. Sells that point to investment
    // releases (anything not in src.releases) keep their existing ref.
    const releaseIdMap = new Map<string, string>();
    const clonedReleases = (src.releases ?? []).map((r) => {
      const newReleaseId = newId();
      releaseIdMap.set(r.id, newReleaseId);
      return { ...r, id: newReleaseId };
    });
    const clonedSells = (src.sells ?? []).map((s) => ({
      ...s,
      id: newId(),
      release_ref: s.release_ref ? (releaseIdMap.get(s.release_ref) ?? s.release_ref) : undefined,
    }));
    const cloned: Scenario = {
      ...src,
      id: newId(),
      name: `${src.name || "Scenario"} (copy)`,
      releases: clonedReleases,
      sells: clonedSells,
      stock_sales: [],
    };
    setAdding(false);
    setEditing(cloned);
  };

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
        <Button onClick={startAdd}>
          <Plus className="h-4 w-4" /> Add scenario
        </Button>
      </div>

      {adding ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur"
          onClick={() => setAdding(false)}
        >
          <div
            className="w-[min(420px,90vw)] rounded-lg border bg-card p-4 space-y-3 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">Add scenario</h2>
            <p className="text-xs text-muted-foreground">
              Start a blank scenario, or clone an existing one (assumptions,
              releases and sells get copied with fresh ids).
            </p>
            <div className="space-y-2">
              <Label className="text-xs">Clone from</Label>
              <Select
                value={cloneSourceId}
                onChange={(e) => setCloneSourceId(e.target.value)}
              >
                {data.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || "Untitled"}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              <Button variant="outline" onClick={confirmAddBlank}>Start blank</Button>
              <Button onClick={confirmAddClone} disabled={!cloneSourceId}>
                Clone selected
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
      if (ov && (ov.starting_share_price !== undefined || ov.annual_price_growth_pct !== undefined || ov.target_share_price !== undefined || ov.termination_date !== undefined)) {
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
      termination_date?: string;
    },
  ) => {
    setD((p) => ({
      ...p,
      stock_overrides: { ...p.stock_overrides, [id]: { ...p.stock_overrides[id], ...ov } },
    }));
  };

  const clearStockField = (
    id: string,
    field: "starting_share_price" | "annual_price_growth_pct" | "target_share_price" | "termination_date",
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

  const addScenarioRelease = () => {
    const firstStock = data.stocks[0];
    setD((p) => ({
      ...p,
      releases: [
        ...(p.releases ?? []),
        {
          id: newId(),
          name: "",
          stock_id: firstStock?.id ?? "",
          release_date: new Date().toISOString().slice(0, 10),
          shares: 0,
        },
      ],
    }));
  };
  const updateScenarioRelease = (
    id: string,
    patch: Partial<{
      name: string;
      stock_id: string;
      release_date: string;
      shares: number;
      shares_pct: number | undefined;
      release_price: number | undefined;
      release_jurisdiction: (typeof SUPPORTED_JURISDICTIONS)[number] | undefined;
      release_tax_rate_pct: number | undefined;
    }>,
  ) => {
    setD((p) => ({
      ...p,
      releases: (p.releases ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  };
  const removeScenarioRelease = (id: string) => {
    setD((p) => ({
      ...p,
      releases: (p.releases ?? []).filter((r) => r.id !== id),
      // Drop any sells that pointed at this release so we don't leave
      // a dangling release_ref.
      sells: (p.sells ?? []).filter((s) => s.release_ref !== id),
    }));
  };

  const addScenarioSell = () => {
    // Pick the first release that isn't already linked from another
    // sell — that's how we keep each release single-sell so there's
    // no double counting against the same named release.
    setD((p) => {
      const taken = new Set(
        (p.sells ?? []).filter((x) => x.release_ref).map((x) => x.release_ref!),
      );
      const investmentReleases = data.stocks.flatMap((h) => h.releases ?? []);
      investmentReleases.sort((a, b) => a.release_date.localeCompare(b.release_date));
      const firstFreeInv = investmentReleases.find((r) => !taken.has(r.id));
      const firstFreeScn = (p.releases ?? []).find((r) => !taken.has(r.id));
      const defaultRef = firstFreeInv?.id ?? firstFreeScn?.id ?? "";
      if (!defaultRef) return p;
      return {
        ...p,
        sells: [
          ...(p.sells ?? []),
          {
            id: newId(),
            name: "",
            release_ref: defaultRef,
            sell_date: new Date().toISOString().slice(0, 10),
            sale_tax_rate_pct: 0,
          },
        ],
      };
    });
  };
  const updateScenarioSell = (
    id: string,
    patch: Partial<{
      name: string;
      release_ref: string | undefined;
      sell_date: string;
      sale_price: number | undefined;
      shares: number | undefined;
      shares_pct: number | undefined;
      sale_jurisdiction: (typeof SUPPORTED_JURISDICTIONS)[number] | undefined;
      sale_tax_rate_pct: number;
    }>,
  ) => {
    setD((p) => ({
      ...p,
      sells: (p.sells ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };
  const removeScenarioSell = (id: string) => {
    setD((p) => ({
      ...p,
      sells: (p.sells ?? []).filter((s) => s.id !== id),
    }));
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
                  ov.target_share_price !== undefined ||
                  ov.termination_date !== undefined;
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
                        <Field
                          label="Termination date"
                          hint="Off by default. When set, any tranche vests after this date are forfeited in this scenario (models being terminated / leaving)."
                        >
                          <Input
                            type="date"
                            value={ov.termination_date ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "") clearStockField(h.id, "termination_date");
                              else updateStockOv(h.id, { termination_date: val });
                            }}
                          />
                        </Field>
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Scenario release events</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={addScenarioRelease}
              disabled={data.stocks.length === 0}
            >
              <Plus className="h-3.5 w-3.5" /> Add release
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Add a future vest you want to model under this scenario&apos;s
            jurisdiction. Income tax is realised at the release date. Sells
            below can pick either a scenario release here or any release
            you&apos;ve recorded against your investments.
          </p>
          {data.stocks.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">Add a stock first.</p>
          ) : (d.releases ?? []).length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No scenario releases.</p>
          ) : (
            <div className="space-y-2">
              {(d.releases ?? []).map((r) => (
                <div key={r.id} className="rounded-md border p-3 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Name" hint="Reference label for sells to pick.">
                      <Input
                        value={r.name ?? ""}
                        placeholder={`e.g. ${r.release_date} refresher`}
                        onChange={(e) => updateScenarioRelease(r.id, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Stock">
                      <Select
                        value={r.stock_id}
                        onChange={(e) => updateScenarioRelease(r.id, { stock_id: e.target.value })}
                      >
                        {data.stocks.map((h) => (
                          <option key={h.id} value={h.id}>{h.ticker || h.company_name || h.id}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Release date">
                      <Input
                        type="date"
                        value={r.release_date}
                        onChange={(e) => updateScenarioRelease(r.id, { release_date: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="Shares"
                      hint={(r.shares_pct ?? 0) > 0 ? "Disabled — using % of vested." : "Released at release_date."}
                    >
                      <Input
                        type="number"
                        step="1"
                        min={0}
                        value={r.shares}
                        disabled={(r.shares_pct ?? 0) > 0}
                        onChange={(e) => updateScenarioRelease(r.id, { shares: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Or % of vested" hint="When > 0, takes precedence over Shares.">
                      <SuffixedInput
                        suffix="%"
                        type="number"
                        step="0.5"
                        min={0}
                        max={100}
                        value={r.shares_pct ?? ""}
                        onChange={(e) =>
                          updateScenarioRelease(r.id, {
                            shares_pct: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Release price" hint="Native currency. Blank = projected price at release.">
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        value={r.release_price ?? ""}
                        onChange={(e) =>
                          updateScenarioRelease(r.id, {
                            release_price: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field label="Release jurisdiction" hint="Where you live at release.">
                      <Select
                        value={r.release_jurisdiction ?? ""}
                        onChange={(e) =>
                          updateScenarioRelease(r.id, {
                            release_jurisdiction:
                              (e.target.value as typeof SUPPORTED_JURISDICTIONS[number]) || undefined,
                          })
                        }
                      >
                        <option value="">(none)</option>
                        {SUPPORTED_JURISDICTIONS.map((j) => (
                          <option key={j} value={j}>{j}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Release income tax"
                      hint={
                        r.release_jurisdiction
                          ? `Default ${RSU_DEFAULT_TAX_RATES[r.release_jurisdiction] ?? 0}%`
                          : "Override the rate here."
                      }
                    >
                      <SuffixedInput
                        suffix="%"
                        type="number"
                        step="0.5"
                        min={0}
                        max={100}
                        value={r.release_tax_rate_pct ?? ""}
                        onChange={(e) =>
                          updateScenarioRelease(r.id, {
                            release_tax_rate_pct: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => removeScenarioRelease(r.id)}>
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Scenario sell events</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={addScenarioSell}
              disabled={(() => {
                const allReleaseIds = [
                  ...data.stocks.flatMap((h) => (h.releases ?? []).map((r) => r.id)),
                  ...(d.releases ?? []).map((r) => r.id),
                ];
                const taken = new Set(
                  (d.sells ?? []).filter((s) => s.release_ref).map((s) => s.release_ref!),
                );
                return allReleaseIds.every((id) => taken.has(id));
              })()}
            >
              <Plus className="h-3.5 w-3.5" /> Add sell
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Each sell is tied to a single named release event (from your
            investments or from a scenario release above). Cap-gains is
            computed against that release&apos;s price. A single release
            event can only be linked once across investments + scenarios
            so there&apos;s no double counting; the math panel on
            Projections shows the full allocation.
          </p>
          {(d.sells ?? []).length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {data.stocks.flatMap((h) => h.releases ?? []).length === 0 &&
              (d.releases ?? []).length === 0
                ? "Add a release event first (in Investments or above)."
                : "No scenario sells yet."}
            </p>
          ) : (
            <div className="space-y-2">
              {(d.sells ?? []).map((s) => {
                // Build the linked-release options: investments releases
                // first (by date), then scenario releases. Deduped by id,
                // and a release already linked from a different sell in
                // this scenario is excluded so each release can only be
                // sold once (no double counting). The current sell's own
                // release_ref is always shown so the user can see / keep
                // their existing selection.
                const takenByOtherSells = new Set(
                  (d.sells ?? [])
                    .filter((x) => x.id !== s.id && x.release_ref)
                    .map((x) => x.release_ref!),
                );
                const seenReleaseIds = new Set<string>();
                const releaseOptions: Array<{ id: string; label: string }> = [];
                const investmentReleases = data.stocks.flatMap((h) =>
                  (h.releases ?? []).map((r) => ({ stock: h, release: r })),
                );
                investmentReleases.sort((a, b) =>
                  a.release.release_date.localeCompare(b.release.release_date),
                );
                for (const { stock, release } of investmentReleases) {
                  if (seenReleaseIds.has(release.id)) continue;
                  if (takenByOtherSells.has(release.id)) continue;
                  seenReleaseIds.add(release.id);
                  const ticker = stock.ticker || stock.company_name || stock.id;
                  const label = `Investments / ${ticker} · ${release.name || release.release_date}`;
                  releaseOptions.push({ id: release.id, label });
                }
                for (const r of d.releases ?? []) {
                  if (seenReleaseIds.has(r.id)) continue;
                  if (takenByOtherSells.has(r.id)) continue;
                  seenReleaseIds.add(r.id);
                  const stock = data.stocks.find((h) => h.id === r.stock_id);
                  const ticker = stock ? (stock.ticker || stock.company_name || stock.id) : r.stock_id;
                  const label = `Scenario / ${ticker} · ${r.name || r.release_date}`;
                  releaseOptions.push({ id: r.id, label });
                }
                return (
                  <div key={s.id} className="rounded-md border p-3 space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Name" hint="Optional label.">
                        <Input
                          value={s.name ?? ""}
                          placeholder="e.g. House deposit"
                          onChange={(e) => updateScenarioSell(s.id, { name: e.target.value })}
                        />
                      </Field>
                      <Field label="Linked release" hint="Sells draw from this single release's kept shares.">
                        <Select
                          value={s.release_ref ?? ""}
                          onChange={(e) =>
                            updateScenarioSell(s.id, {
                              release_ref: e.target.value || undefined,
                            })
                          }
                        >
                          {releaseOptions.length === 0 ? (
                            <option value="">(no releases)</option>
                          ) : null}
                          {releaseOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Field label="Sell date" hint="Cash added to net worth.">
                        <Input
                          type="date"
                          value={s.sell_date}
                          onChange={(e) => updateScenarioSell(s.id, { sell_date: e.target.value })}
                        />
                      </Field>
                      <Field label="Sale price" hint="Native currency. Blank = projected price at sell.">
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={s.sale_price ?? ""}
                          onChange={(e) =>
                            updateScenarioSell(s.id, {
                              sale_price: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                      <Field
                        label="Shares"
                        hint={(s.shares_pct ?? 0) > 0 ? "Disabled — using % of kept." : "Blank = all kept from release."}
                      >
                        <Input
                          type="number"
                          step="1"
                          min={0}
                          value={s.shares ?? ""}
                          disabled={(s.shares_pct ?? 0) > 0}
                          onChange={(e) =>
                            updateScenarioSell(s.id, {
                              shares: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Field label="Or % of kept" hint="When > 0, takes precedence over Shares.">
                        <SuffixedInput
                          suffix="%"
                          type="number"
                          step="0.5"
                          min={0}
                          max={100}
                          value={s.shares_pct ?? ""}
                          onChange={(e) =>
                            updateScenarioSell(s.id, {
                              shares_pct: e.target.value === "" ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                      <Field label="Sale jurisdiction" hint="Where you live at sale.">
                        <Select
                          value={s.sale_jurisdiction ?? ""}
                          onChange={(e) =>
                            updateScenarioSell(s.id, {
                              sale_jurisdiction:
                                (e.target.value as typeof SUPPORTED_JURISDICTIONS[number]) || undefined,
                            })
                          }
                        >
                          <option value="">(none)</option>
                          {SUPPORTED_JURISDICTIONS.map((j) => (
                            <option key={j} value={j}>{j}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field
                        label="Cap-gains tax"
                        hint={
                          s.sale_jurisdiction
                            ? `Default ${defaultSaleTaxRate(s.sale_jurisdiction)}%`
                            : "Applied to (sale − release) × shares."
                        }
                      >
                        <SuffixedInput
                          suffix="%"
                          type="number"
                          step="0.5"
                          min={0}
                          max={100}
                          value={s.sale_tax_rate_pct}
                          onChange={(e) => updateScenarioSell(s.id, { sale_tax_rate_pct: Number(e.target.value) })}
                        />
                      </Field>
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => removeScenarioSell(s.id)}>
                        <Trash2 className="h-4 w-4" /> Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
