"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { newId, Scenario, ScenarioSchema } from "@/lib/models";
import { formatMoney } from "@/lib/utils";

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
            <Card key={s.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <CardDescription>
                    {s.horizon_years}y · stocks {s.default_stock_growth_pct.toFixed(1)}%/yr · property{" "}
                    {s.default_property_growth_pct.toFixed(1)}%/yr
                    {s.inflation_pct ? ` · inflation ${s.inflation_pct.toFixed(1)}%` : ""}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing({ ...s })}>
                    Edit
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
          ))
        )}
      </div>

      {editing ? <ScenarioForm draft={editing} onCancel={() => setEditing(null)} onSave={save} /> : null}
    </div>
  );
}

function ScenarioForm({ draft, onCancel, onSave }: { draft: Scenario; onCancel: () => void; onSave: (s: Scenario) => Promise<void> }) {
  const { data } = useData();
  const [d, setD] = useState<Scenario>(draft);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof Scenario>(k: K, v: Scenario[K]) => setD((p) => ({ ...p, [k]: v }));

  const updateStockOv = (
    id: string,
    ov: { annual_price_growth_pct?: number; target_share_price?: number },
  ) => {
    setD((p) => ({
      ...p,
      stock_overrides: { ...p.stock_overrides, [id]: { ...p.stock_overrides[id], ...ov } },
    }));
  };

  const clearStockField = (id: string, field: "annual_price_growth_pct" | "target_share_price") => {
    setD((p) => {
      const cur = { ...(p.stock_overrides[id] ?? {}) };
      delete cur[field];
      return { ...p, stock_overrides: { ...p.stock_overrides, [id]: cur } };
    });
  };

  const updatePropOv = (id: string, ov: { annual_growth_pct?: number }) => {
    setD((p) => ({
      ...p,
      property_overrides: { ...p.property_overrides, [id]: { ...p.property_overrides[id], ...ov } },
    }));
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
    <Card>
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
                const usingTarget = ov.target_share_price !== undefined && ov.target_share_price > 0;
                const usingRate = ov.annual_price_growth_pct !== undefined && !usingTarget;
                // Implied annual growth from target, for display next to the field
                const impliedFromTarget =
                  usingTarget && h.current_share_price > 0 && d.horizon_years > 0
                    ? (Math.pow((ov.target_share_price ?? 0) / h.current_share_price, 1 / d.horizon_years) - 1) * 100
                    : null;
                const effectiveRate = usingTarget
                  ? impliedFromTarget ?? d.default_stock_growth_pct
                  : ov.annual_price_growth_pct ?? d.default_stock_growth_pct;
                return (
                  <div key={h.id} className="rounded-md border p-2 space-y-2">
                    <div className="text-sm">
                      <div className="font-medium">{h.ticker || h.company_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        current {formatMoney(h.current_share_price, h.currency, { fractionDigits: 2 })}/sh
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                        label={`Target price at +${d.horizon_years}y`}
                        hint={
                          h.currency
                            ? `In ${h.currency}. Leave blank to use the rate.`
                            : "Leave blank to use the rate."
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
                          Target {formatMoney(ov.target_share_price ?? 0, h.currency, { fractionDigits: 2 })} → implied{" "}
                          <b>{effectiveRate.toFixed(1)}%/yr</b>
                        </>
                      ) : usingRate ? (
                        <>Overrides default — using <b>{effectiveRate.toFixed(1)}%/yr</b></>
                      ) : (
                        <>Using default {d.default_stock_growth_pct}%/yr</>
                      )}
                    </p>
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
            <div className="hidden sm:grid grid-cols-[2fr_1fr] gap-2 px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Property</span>
              <span>Growth (overrides default {d.default_property_growth_pct}%/yr)</span>
            </div>
            <div className="space-y-2">
              {data.properties.map((p) => {
                const ov = d.property_overrides[p.id] ?? {};
                const rate = ov.annual_growth_pct ?? d.default_property_growth_pct;
                const usingOverride = ov.annual_growth_pct !== undefined;
                return (
                  <div
                    key={p.id}
                    className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[2fr_1fr]"
                  >
                    <div className="text-sm">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.suburb}, {p.region} · current {formatMoney(p.current_value, p.currency)}
                      </div>
                    </div>
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
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

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
  ...props
}: { suffix: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Input className="pr-12" {...props} />
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
