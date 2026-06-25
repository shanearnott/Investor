"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Copy, Plus, Trash2 } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { newId } from "@/lib/models";
import {
  RevolverScenario,
  RevolverScenarioSchema,
  ResolvedRevolverInputs,
  computeFacility,
  computeSellVsBorrow,
  newRevolverScenario,
  resolveRevolverInputs,
  solveBreakevenFutureTaxRate,
  solveBreakevenSofr,
  sweepFutureTaxRate,
  withResolvedInputs,
  type FacilityResult,
} from "@/lib/revolver";
import { cn, formatMoney, formatMoneyCompact, formatNumber, formatNumberCompact } from "@/lib/utils";

const USD = "USD";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatMmmYY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) return iso;
  const monthIdx = Number(m[2]) - 1;
  const yy = m[1].slice(2);
  if (monthIdx < 0 || monthIdx > 11) return iso;
  return `${MONTH_SHORT[monthIdx]}-${yy}`;
}

const compactFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
function compactNumber(v: number): string {
  return compactFormatter.format(v);
}

function parseRevolvers(raw: unknown[]): RevolverScenario[] {
  const out: RevolverScenario[] = [];
  for (const r of raw) {
    const p = RevolverScenarioSchema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

export default function RevolverPage() {
  const { data, setRevolvers } = useData();
  const stored = useMemo(() => parseRevolvers(data.revolvers ?? []), [data.revolvers]);
  const [activeId, setActiveId] = useState<string>("");
  const [view, setView] = useState<"facility" | "sell-vs-borrow">("facility");

  // Seed from storage; if empty, create an unsaved default scenario in memory
  // so the page is interactive on first visit.
  const [scenario, setScenario] = useState<RevolverScenario>(() =>
    stored[0] ?? newRevolverScenario("Anduril ELP — baseline"),
  );
  useEffect(() => {
    if (!activeId && stored.length > 0) {
      setActiveId(stored[0].id);
      setScenario(stored[0]);
    }
  }, [stored, activeId]);

  const persist = async (next: RevolverScenario[]) => {
    await setRevolvers(next as unknown as unknown[]);
  };

  const saveActive = async () => {
    const i = stored.findIndex((s) => s.id === scenario.id);
    const next = [...stored];
    if (i >= 0) next[i] = scenario;
    else next.push(scenario);
    await persist(next);
    setActiveId(scenario.id);
  };

  const newBlank = () => {
    const s = newRevolverScenario(`Scenario ${stored.length + 1}`);
    setScenario(s);
    setActiveId(s.id);
  };

  const cloneActive = () => {
    const cloned: RevolverScenario = {
      ...scenario,
      id: newId(),
      name: `${scenario.name || "Revolver"} (copy)`,
      lots: scenario.lots.map((l) => ({ ...l, id: newId() })),
      sofr_overrides: (scenario.sofr_overrides ?? []).map((o) => ({ ...o, id: newId() })),
    };
    // Re-point selected lot at the cloned lot in the same position.
    const idx = scenario.lots.findIndex((l) => l.id === scenario.selected_lot_id);
    if (idx >= 0 && cloned.lots[idx]) cloned.selected_lot_id = cloned.lots[idx].id;
    setScenario(cloned);
    setActiveId(cloned.id);
  };

  const removeActive = async () => {
    const next = stored.filter((s) => s.id !== scenario.id);
    await persist(next);
    if (next.length > 0) {
      setScenario(next[0]);
      setActiveId(next[0].id);
    } else {
      const fresh = newRevolverScenario("Anduril ELP — baseline");
      setScenario(fresh);
      setActiveId("");
    }
  };

  // Resolve stock-linked / scenario-linked values live; the engine
  // always sees the effective scenario.
  const resolved = useMemo(
    () => resolveRevolverInputs(scenario, data.stocks, data.scenarios),
    [scenario, data.stocks, data.scenarios],
  );
  const effective = useMemo(() => withResolvedInputs(scenario, resolved), [scenario, resolved]);

  const facilityMonthly = useMemo(() => computeFacility(effective, "monthly"), [effective]);
  const facilityCapitalise = useMemo(() => computeFacility(effective, "capitalise"), [effective]);
  const facility = effective.interest_mode === "monthly" ? facilityMonthly : facilityCapitalise;
  const sellVsBorrow = useMemo(() => computeSellVsBorrow(effective), [effective]);
  const breakevenTax = useMemo(() => solveBreakevenFutureTaxRate(effective), [effective]);
  const breakevenSofr = useMemo(() => solveBreakevenSofr(effective), [effective]);
  const taxSweep = useMemo(() => sweepFutureTaxRate(effective), [effective]);

  const isStored = stored.some((s) => s.id === scenario.id);
  const dirty = isStored ? JSON.stringify(stored.find((s) => s.id === scenario.id)) !== JSON.stringify(scenario) : true;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Revolver</h1>
          <p className="text-xs text-muted-foreground">
            JP Morgan Anduril Executive Lending Program — model the facility and decide sell vs borrow.
          </p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={newBlank}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
          <Button size="sm" variant="outline" onClick={cloneActive} title="Clone this scenario">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant={dirty ? "default" : "outline"} onClick={saveActive}>
            Save
          </Button>
          {isStored ? (
            <Button size="sm" variant="ghost" onClick={removeActive}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {stored.length > 0 ? (
        <ScenarioPicker
          stored={stored}
          activeId={activeId}
          onPick={(s) => {
            setScenario(s);
            setActiveId(s.id);
          }}
        />
      ) : null}

      <ScenarioForm
        scenario={scenario}
        onChange={setScenario}
        resolved={resolved}
      />

      <div className="flex gap-2 border-b pb-0">
        <button
          type="button"
          onClick={() => setView("facility")}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
            view === "facility" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Facility model
        </button>
        <button
          type="button"
          onClick={() => setView("sell-vs-borrow")}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
            view === "sell-vs-borrow" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Sell vs Borrow
        </button>
      </div>

      {view === "facility" ? (
        <FacilityView
          scenario={effective}
          facility={facility}
          monthly={facilityMonthly}
          capitalise={facilityCapitalise}
        />
      ) : (
        <SellVsBorrowView
          scenario={effective}
          result={sellVsBorrow}
          breakevenTax={breakevenTax}
          breakevenSofr={breakevenSofr}
          taxSweep={taxSweep}
        />
      )}
    </div>
  );
}

function ScenarioPicker({
  stored,
  activeId,
  onPick,
}: {
  stored: RevolverScenario[];
  activeId: string;
  onPick: (s: RevolverScenario) => void;
}) {
  if (stored.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {stored.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium",
            s.id === activeId ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {s.name || "Untitled"}
        </button>
      ))}
    </div>
  );
}

function ScenarioForm({
  scenario,
  onChange,
  resolved,
}: {
  scenario: RevolverScenario;
  onChange: (s: RevolverScenario) => void;
  resolved: ResolvedRevolverInputs;
}) {
  const { data } = useData();
  const upd = <K extends keyof RevolverScenario>(k: K, v: RevolverScenario[K]) => onChange({ ...scenario, [k]: v });
  const linkedToStock = !!scenario.stock_id;
  const linkedToScenario = !!scenario.scenario_id;
  const addOverride = () => {
    onChange({
      ...scenario,
      sofr_overrides: [
        ...(scenario.sofr_overrides ?? []),
        { id: newId(), from_date: new Date().toISOString().slice(0, 10), rate_pct: scenario.sofr_base_pct },
      ],
    });
  };
  const updOverride = (id: string, patch: Partial<{ from_date: string; rate_pct: number }>) => {
    onChange({
      ...scenario,
      sofr_overrides: (scenario.sofr_overrides ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  };
  const removeOverride = (id: string) => {
    onChange({ ...scenario, sofr_overrides: (scenario.sofr_overrides ?? []).filter((o) => o.id !== id) });
  };

  const addLot = () => {
    onChange({
      ...scenario,
      lots: [...scenario.lots, { id: newId(), name: `Lot ${scenario.lots.length + 1}`, cost_basis: 0 }],
    });
  };
  const updLot = (id: string, patch: Partial<{ name: string; cost_basis: number }>) => {
    onChange({ ...scenario, lots: scenario.lots.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  };
  const removeLot = (id: string) => {
    const next = scenario.lots.filter((l) => l.id !== id);
    onChange({
      ...scenario,
      lots: next,
      selected_lot_id: scenario.selected_lot_id === id ? next[0]?.id ?? "" : scenario.selected_lot_id,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Inputs</CardTitle>
        <CardDescription>
          Link a stock from <b>Investments</b> and a scenario from
          <b> Scenarios</b> to drive share price, share count, growth
          and cost-basis lots from the rest of the app. Advance rate
          and the SOFR path are <b>assumptions</b>, not facts — the
          term sheet doesn&apos;t disclose them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Link block — picks a stock for derived values + a scenario
            for growth. Unlinking restores the manual fields. */}
        <div className="rounded-md border bg-blue-50/60 p-3 space-y-2">
          <div className="text-xs font-semibold text-blue-900">Link to Investments + Scenarios</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field
              label="Linked stock"
              hint={
                linkedToStock
                  ? `Drives share price, shares available, cost-basis lots.`
                  : "Pick a stock from Investments to derive values automatically."
              }
            >
              <Select
                value={scenario.stock_id ?? ""}
                onChange={(e) => upd("stock_id", e.target.value || undefined)}
              >
                <option value="">— manual (no link) —</option>
                {data.stocks.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.ticker || h.company_name || h.id}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Linked scenario"
              hint={
                linkedToScenario
                  ? `Drives annual price appreciation.`
                  : "Pick a scenario to derive the growth assumption."
              }
            >
              <Select
                value={scenario.scenario_id ?? ""}
                onChange={(e) => upd("scenario_id", e.target.value || undefined)}
              >
                <option value="">— manual (no link) —</option>
                {data.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || "Untitled"}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Scenario name">
            <Input value={scenario.name} onChange={(e) => upd("name", e.target.value)} />
          </Field>
          <Field label="Cash needed / draw" hint={`Max $${formatNumberCompact(scenario.max_draw)}`}>
            <SuffixedInput
              suffix="$"
              type="number"
              min={0}
              max={scenario.max_draw}
              step={50_000}
              value={scenario.draw_amount}
              onChange={(e) => upd("draw_amount", Math.min(scenario.max_draw, Math.max(0, Number(e.target.value))))}
            />
          </Field>
          <Field label="Max facility size">
            <SuffixedInput
              suffix="$"
              type="number"
              min={0}
              step={500_000}
              value={scenario.max_draw}
              onChange={(e) => upd("max_draw", Math.max(0, Number(e.target.value)))}
            />
          </Field>
          <Field label="Start date">
            <Input
              type="date"
              value={scenario.start_date}
              onChange={(e) => upd("start_date", e.target.value)}
            />
          </Field>
          <Field label="Projection end">
            <Input
              type="date"
              value={scenario.end_date}
              onChange={(e) => upd("end_date", e.target.value)}
            />
          </Field>
          <Field label="IPO date (optional)" hint="If set, the facility matures at IPO.">
            <Input
              type="date"
              value={scenario.ipo_date ?? ""}
              onChange={(e) => upd("ipo_date", e.target.value || undefined)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Interest mode">
            <Select
              value={scenario.interest_mode}
              onChange={(e) => upd("interest_mode", e.target.value as RevolverScenario["interest_mode"])}
            >
              <option value="monthly">Pay monthly (cash out)</option>
              <option value="capitalise">Capitalise (balance compounds)</option>
            </Select>
          </Field>
          <Field label="Day-count">
            <Select
              value={scenario.day_count}
              onChange={(e) => upd("day_count", e.target.value as RevolverScenario["day_count"])}
            >
              <option value="actual360">Actual / 360</option>
              <option value="monthly30">Monthly approx (rate / 12)</option>
            </Select>
          </Field>
          <Field label="Spread over SOFR">
            <SuffixedInput
              suffix="%"
              type="number"
              step={0.05}
              min={0}
              max={20}
              value={scenario.spread_pct}
              onChange={(e) => upd("spread_pct", Number(e.target.value))}
            />
          </Field>
          <Field label="SOFR base">
            <SuffixedInput
              suffix="%/yr"
              type="number"
              step={0.01}
              min={0}
              max={50}
              value={scenario.sofr_base_pct}
              onChange={(e) => upd("sofr_base_pct", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Share price (today)"
            hint={linkedToStock ? `From ${resolved.sources.share_price}` : undefined}
          >
            {linkedToStock ? (
              <DerivedValue>{formatMoney(resolved.share_price, USD, { fractionDigits: 2 })}</DerivedValue>
            ) : (
              <SuffixedInput
                suffix="$"
                type="number"
                step={0.01}
                min={0}
                value={scenario.share_price}
                onChange={(e) => upd("share_price", Number(e.target.value))}
              />
            )}
          </Field>
          <Field
            label="Annual price appreciation"
            hint={linkedToScenario ? `From ${resolved.sources.annual_appreciation_pct}` : undefined}
          >
            {linkedToScenario ? (
              <DerivedValue>{resolved.annual_appreciation_pct.toFixed(2)} %/yr</DerivedValue>
            ) : (
              <SuffixedInput
                suffix="%/yr"
                type="number"
                step={0.5}
                value={scenario.annual_appreciation_pct}
                onChange={(e) => upd("annual_appreciation_pct", Number(e.target.value))}
              />
            )}
          </Field>
        </div>

        {/* Assumption block — visually pop the two undisclosed inputs */}
        <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3 space-y-2">
          <div className="text-xs font-semibold text-amber-900">Assumptions (not from the term sheet)</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Advance rate (max LTV)" hint="UNDISCLOSED — typical SBLOC = 50%.">
              <SuffixedInput
                suffix="%"
                type="number"
                step={1}
                min={0}
                max={100}
                value={scenario.advance_rate_pct}
                onChange={(e) => upd("advance_rate_pct", Number(e.target.value))}
              />
            </Field>
            <Field label="Maintenance LTV" hint="Margin-call trigger.">
              <SuffixedInput
                suffix="%"
                type="number"
                step={1}
                min={0}
                max={100}
                value={scenario.maintenance_ltv_pct}
                onChange={(e) => upd("maintenance_ltv_pct", Number(e.target.value))}
              />
            </Field>
            <Field
              label="Total shares available"
              hint={linkedToStock ? `From ${resolved.sources.total_shares_available}` : undefined}
            >
              {linkedToStock ? (
                <DerivedValue>{formatNumber(resolved.total_shares_available)} sh</DerivedValue>
              ) : (
                <Input
                  type="number"
                  min={0}
                  step={1000}
                  value={scenario.total_shares_available}
                  onChange={(e) => upd("total_shares_available", Number(e.target.value))}
                />
              )}
            </Field>
          </div>
        </div>

        {/* SOFR overrides */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>SOFR path overrides</Label>
            <Button size="sm" variant="outline" onClick={addOverride}>
              <Plus className="h-3.5 w-3.5" /> Add cut/hike
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Each row sets the base SOFR from that date forward. Spread is
            added on top. Leave the list empty to keep the base flat.
          </p>
          {(scenario.sofr_overrides ?? []).length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No overrides — base SOFR holds.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {scenario.sofr_overrides.map((o) => (
                <div key={o.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-md border p-2">
                  <Field label="From">
                    <Input
                      type="date"
                      value={o.from_date}
                      onChange={(e) => updOverride(o.id, { from_date: e.target.value })}
                    />
                  </Field>
                  <Field label="SOFR">
                    <SuffixedInput
                      suffix="%"
                      type="number"
                      step={0.05}
                      min={0}
                      max={50}
                      value={o.rate_pct}
                      onChange={(e) => updOverride(o.id, { rate_pct: Number(e.target.value) })}
                    />
                  </Field>
                  <Button size="sm" variant="ghost" onClick={() => removeOverride(o.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lots + tax (Sell vs Borrow inputs). When a stock is linked,
            lots come from its release events; otherwise the user types
            them in. */}
        <div className="space-y-2">
          <Label>Cost basis lots</Label>
          <p className="text-[11px] text-muted-foreground">
            {linkedToStock ? (
              <>
                Derived from <b>{resolved.sources.lots}</b> — pick which one is sold
                first. Selling a high-basis (near-price) lot collapses today&apos;s tax bill toward zero.
              </>
            ) : (
              <>Pick which lot is sold first. Selling a high-basis (near-price) lot collapses today&apos;s tax bill toward zero.</>
            )}
          </p>
          {linkedToStock ? (
            resolved.lots.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No release events recorded on this stock yet — add one in Investments to give the sell math a basis.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {resolved.lots.map((l) => (
                  <label
                    key={l.id}
                    className={cn(
                      "grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border p-2 text-xs",
                      resolved.selected_lot_id === l.id ? "border-primary" : "",
                    )}
                  >
                    <input
                      type="radio"
                      checked={resolved.selected_lot_id === l.id}
                      onChange={() => upd("selected_lot_id", l.id)}
                    />
                    <span className="font-medium">{l.name}</span>
                    <span className="tabular-nums">{formatMoney(l.cost_basis, USD, { fractionDigits: 2 })}/sh</span>
                  </label>
                ))}
              </div>
            )
          ) : scenario.lots.length === 0 ? (
            <Button size="sm" variant="outline" onClick={addLot}>
              <Plus className="h-3.5 w-3.5" /> Add lot
            </Button>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {scenario.lots.map((l) => (
                <div key={l.id} className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-2 rounded-md border p-2">
                  <div className="self-center">
                    <input
                      type="radio"
                      checked={scenario.selected_lot_id === l.id}
                      onChange={() => upd("selected_lot_id", l.id)}
                      title="Selected lot"
                    />
                  </div>
                  <Field label="Name">
                    <Input value={l.name} onChange={(e) => updLot(l.id, { name: e.target.value })} />
                  </Field>
                  <Field label="Basis / share">
                    <SuffixedInput
                      suffix="$"
                      type="number"
                      step={0.01}
                      min={0}
                      value={l.cost_basis}
                      onChange={(e) => updLot(l.id, { cost_basis: Number(e.target.value) })}
                    />
                  </Field>
                  <Button size="sm" variant="ghost" onClick={() => removeLot(l.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={addLot}>
                <Plus className="h-3.5 w-3.5" /> Add lot
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Tax today" hint="CA combined LTCG ≈ 37.1%.">
            <SuffixedInput
              suffix="%"
              type="number"
              step={0.1}
              min={0}
              max={100}
              value={scenario.tax_rate_today_pct}
              onChange={(e) => upd("tax_rate_today_pct", Number(e.target.value))}
            />
          </Field>
          <Field label="Tax at future sale" hint="Cyprus NRA = 0% on listed securities.">
            <SuffixedInput
              suffix="%"
              type="number"
              step={0.1}
              min={0}
              max={100}
              value={scenario.tax_rate_future_pct}
              onChange={(e) => upd("tax_rate_future_pct", Number(e.target.value))}
            />
          </Field>
          <Field label="Repayment date" hint="Defaults to IPO date if set, else horizon end.">
            <Input
              type="date"
              value={scenario.repayment_date ?? ""}
              onChange={(e) => upd("repayment_date", e.target.value || undefined)}
            />
          </Field>
          <Field label="Future basis (repayment)" hint="Blank = selected lot's basis.">
            <SuffixedInput
              suffix="$"
              type="number"
              step={0.01}
              min={0}
              value={scenario.future_basis ?? ""}
              onChange={(e) => upd("future_basis", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label="Description">
          <Textarea
            value={scenario.description}
            onChange={(e) => upd("description", e.target.value)}
            placeholder="e.g. Baseline assumes 50% LTV, Cyprus by 2028."
          />
        </Field>
      </CardContent>
    </Card>
  );
}

// ----- Facility view -----

function FacilityView({
  scenario,
  facility,
  monthly,
  capitalise,
}: {
  scenario: RevolverScenario;
  facility: FacilityResult;
  monthly: FacilityResult;
  capitalise: FacilityResult;
}) {
  const totalBalanceGrowth = capitalise.ending_balance - scenario.draw_amount;
  const chartData = useMemo(() => {
    const len = Math.max(monthly.rows.length, capitalise.rows.length);
    const rows: Array<{
      date: string;
      monthly_balance: number;
      cap_balance: number;
      cumulative_interest_monthly: number;
      cumulative_interest_capitalise: number;
      required_shares: number;
      ltv_pct: number;
    }> = [];
    let cumMonthly = 0;
    let cumCap = 0;
    for (let i = 0; i < len; i++) {
      const m = monthly.rows[i];
      const c = capitalise.rows[i];
      cumMonthly += m?.interest ?? 0;
      cumCap += c?.interest ?? 0;
      rows.push({
        date: m?.date ?? c?.date ?? "",
        monthly_balance: m?.balance_end ?? 0,
        cap_balance: c?.balance_end ?? 0,
        cumulative_interest_monthly: cumMonthly,
        cumulative_interest_capitalise: cumCap,
        required_shares: facility.rows[i]?.required_shares ?? 0,
        ltv_pct: facility.rows[i]?.current_ltv_pct ?? 0,
      });
    }
    return rows;
  }, [monthly, capitalise, facility]);

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Kpi label="Total interest" value={formatMoney(facility.total_interest, USD)} hint={facility.mode === "monthly" ? "Cash paid out" : "Rolled into balance"} />
        <Kpi label="Ending balance" value={formatMoney(facility.ending_balance, USD)} />
        <Kpi label="Effective all-in rate" value={`${facility.effective_annual_rate_pct.toFixed(2)} %/yr`} hint="Geometric over horizon" />
        <Kpi label="Peak shares pledged" value={formatNumber(facility.peak_required_shares)} hint={`${formatNumber(scenario.total_shares_available)} available`} />
        <Kpi label="Ending LTV" value={`${facility.ending_ltv_pct.toFixed(1)} %`} hint={`Maintenance ${scenario.maintenance_ltv_pct.toFixed(0)}%`} />
        {facility.mode === "capitalise" ? (
          <Kpi label="Total balance growth" value={formatMoney(totalBalanceGrowth, USD)} />
        ) : (
          <Kpi label="Cash interest paid" value={formatMoney(facility.total_cash_interest, USD)} />
        )}
      </div>

      {/* Side-by-side mode comparison */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pay monthly vs Capitalise (same inputs)</CardTitle>
          <CardDescription>
            How the two interest treatments diverge by the end of the
            horizon for the current draw amount.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                <th className="text-left font-normal px-2 py-1.5">Metric</th>
                <th className="text-right font-normal px-2 py-1.5">Pay monthly</th>
                <th className="text-right font-normal px-2 py-1.5">Capitalise</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="px-2 py-1.5">Total interest</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(monthly.total_interest, USD)}</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(capitalise.total_interest, USD)}</td>
              </tr>
              <tr className="border-b">
                <td className="px-2 py-1.5">Total cash outflow</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(monthly.total_cash_interest, USD)}</td>
                <td className="px-2 py-1.5 text-right">$0</td>
              </tr>
              <tr className="border-b">
                <td className="px-2 py-1.5">Ending balance</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(monthly.ending_balance, USD)}</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(capitalise.ending_balance, USD)}</td>
              </tr>
              <tr>
                <td className="px-2 py-1.5">Peak collateral shares</td>
                <td className="px-2 py-1.5 text-right">{formatNumber(monthly.peak_required_shares)}</td>
                <td className="px-2 py-1.5 text-right">{formatNumber(capitalise.peak_required_shares)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Chart: balance both modes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Outstanding balance</CardTitle>
          <CardDescription>Pay-monthly stays flat; capitalise compounds.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={formatMmmYY} tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compactNumber} />
                <Tooltip
                  formatter={(v: number) => formatMoneyCompact(v, USD)}
                  labelFormatter={(l) => formatMmmYY(String(l))}
                />
                <Legend />
                <Line type="monotone" dataKey="monthly_balance" name="Pay monthly" stroke="#0ea5e9" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="cap_balance" name="Capitalise" stroke="#f97316" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cumulative interest cost</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={formatMmmYY} tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compactNumber} />
                <Tooltip
                  formatter={(v: number) => formatMoneyCompact(v, USD)}
                  labelFormatter={(l) => formatMmmYY(String(l))}
                />
                <Legend />
                <Line type="monotone" dataKey="cumulative_interest_monthly" name="Pay monthly" stroke="#0ea5e9" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="cumulative_interest_capitalise" name="Capitalise (accrued)" stroke="#f97316" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Required collateral shares</CardTitle>
          <CardDescription>Reference line: total shares available.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={formatMmmYY} tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compactNumber} />
                <Tooltip
                  formatter={(v: number) => formatNumber(v)}
                  labelFormatter={(l) => formatMmmYY(String(l))}
                />
                <Legend />
                <Line type="monotone" dataKey="required_shares" name="Required shares" stroke="#10b981" dot={false} strokeWidth={2} />
                <ReferenceLine y={scenario.total_shares_available} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Available", fontSize: 11, fill: "#ef4444" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">LTV vs maintenance threshold</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={formatMmmYY} tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip
                  formatter={(v: number) => `${v.toFixed(1)}%`}
                  labelFormatter={(l) => formatMmmYY(String(l))}
                />
                <Legend />
                <Line type="monotone" dataKey="ltv_pct" name="Current LTV" stroke="#6366f1" dot={false} strokeWidth={2} />
                <ReferenceLine y={scenario.maintenance_ltv_pct} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `Maintenance ${scenario.maintenance_ltv_pct}%`, fontSize: 11, fill: "#ef4444" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Monthly schedule</CardTitle>
          <CardDescription>Click to expand the full per-month table.</CardDescription>
        </CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              {facility.rows.length} months · {facility.mode === "monthly" ? "Pay monthly" : "Capitalise"}
            </summary>
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                    <th className="text-left font-normal px-2 py-1">Date</th>
                    <th className="text-right font-normal px-2 py-1">Balance</th>
                    <th className="text-right font-normal px-2 py-1">Interest</th>
                    <th className="text-right font-normal px-2 py-1">Cash paid</th>
                    <th className="text-right font-normal px-2 py-1">Req. shares</th>
                    <th className="text-right font-normal px-2 py-1">LTV</th>
                    <th className="text-right font-normal px-2 py-1">Headroom</th>
                  </tr>
                </thead>
                <tbody>
                  {facility.rows.map((r) => (
                    <tr
                      key={r.month_index}
                      className={cn(
                        "border-b last:border-0",
                        (r.flags.ltv_breach || r.flags.undercollateralised) && "bg-rose-50",
                      )}
                    >
                      <td className="px-2 py-1">{formatMmmYY(r.date)}</td>
                      <td className="px-2 py-1 text-right">{formatMoneyCompact(r.balance_end, USD)}</td>
                      <td className="px-2 py-1 text-right">{formatMoneyCompact(r.interest, USD)}</td>
                      <td className="px-2 py-1 text-right">{formatMoneyCompact(r.cash_paid, USD)}</td>
                      <td className="px-2 py-1 text-right">{formatNumber(r.required_shares)}</td>
                      <td className="px-2 py-1 text-right">{r.current_ltv_pct.toFixed(1)}%</td>
                      <td className={cn("px-2 py-1 text-right", r.margin_call_headroom < 0 ? "text-rose-700 font-semibold" : "")}>
                        {formatMoneyCompact(r.margin_call_headroom, USD)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

// ----- Sell vs Borrow view -----

function SellVsBorrowView({
  scenario,
  result,
  breakevenTax,
  breakevenSofr,
  taxSweep,
}: {
  scenario: RevolverScenario;
  result: ReturnType<typeof computeSellVsBorrow>;
  breakevenTax: number | null;
  breakevenSofr: number | null;
  taxSweep: ReturnType<typeof sweepFutureTaxRate>;
}) {
  const leaderLabel: Record<typeof result.verdict.leader, string> = {
    sell: "Sell wins",
    borrow_monthly: "Borrow (pay monthly) wins",
    borrow_capitalise: "Borrow (capitalise) wins",
  };
  const absDelta = Math.abs(result.verdict.delta);

  return (
    <div className="space-y-4">
      {/* Verdict */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Verdict at horizon</CardTitle>
          <CardDescription>
            Live: terminal net worth on each path, including future tax and
            (pay-monthly) cumulative interest paid in cash.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-2xl font-semibold tabular-nums">
            {leaderLabel[result.verdict.leader]}{" "}
            <span className="text-base font-normal text-muted-foreground">by {formatMoney(absDelta, USD)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{result.verdict.explanation}</p>
        </CardContent>
      </Card>

      {/* Side-by-side path table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Path comparison</CardTitle>
          <CardDescription>
            All amounts in USD. Terminal net worth = remaining shares ×
            price-at-horizon, less cumulative cash interest (borrow
            pay-monthly only).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                <th className="text-left font-normal px-2 py-1.5">Metric</th>
                <th className="text-right font-normal px-2 py-1.5">Sell now</th>
                <th className="text-right font-normal px-2 py-1.5">Borrow · monthly</th>
                <th className="text-right font-normal px-2 py-1.5">Borrow · capitalise</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="px-2 py-1.5">Tax paid now</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(result.sell.tax_paid_now, USD)}</td>
                <td className="px-2 py-1.5 text-right">$0</td>
                <td className="px-2 py-1.5 text-right">$0</td>
              </tr>
              <tr className="border-b">
                <td className="px-2 py-1.5">Cumulative cash interest</td>
                <td className="px-2 py-1.5 text-right">—</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(result.borrow_monthly.total_cash_interest, USD)}</td>
                <td className="px-2 py-1.5 text-right">$0 <span className="text-[10px] text-muted-foreground">(rolled in)</span></td>
              </tr>
              <tr className="border-b">
                <td className="px-2 py-1.5">Balance at repayment</td>
                <td className="px-2 py-1.5 text-right">—</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(result.borrow_monthly.balance_at_repayment, USD)}</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(result.borrow_capitalise.balance_at_repayment, USD)}</td>
              </tr>
              <tr className="border-b">
                <td className="px-2 py-1.5">Tax paid future</td>
                <td className="px-2 py-1.5 text-right">$0</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(result.borrow_monthly.tax_paid_future, USD)}</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(result.borrow_capitalise.tax_paid_future, USD)}</td>
              </tr>
              <tr className="border-b">
                <td className="px-2 py-1.5">Shares disposed</td>
                <td className="px-2 py-1.5 text-right">{formatNumber(result.sell.shares_sold)}</td>
                <td className="px-2 py-1.5 text-right">{formatNumber(result.borrow_monthly.shares_sold_to_repay)}</td>
                <td className="px-2 py-1.5 text-right">{formatNumber(result.borrow_capitalise.shares_sold_to_repay)}</td>
              </tr>
              <tr className="border-b">
                <td className="px-2 py-1.5">Shares retained @ horizon</td>
                <td className="px-2 py-1.5 text-right">{formatNumber(result.sell.remaining_shares)}</td>
                <td className="px-2 py-1.5 text-right">{formatNumber(result.borrow_monthly.remaining_shares)}</td>
                <td className="px-2 py-1.5 text-right">{formatNumber(result.borrow_capitalise.remaining_shares)}</td>
              </tr>
              <tr className="bg-muted/40">
                <td className="px-2 py-1.5 font-semibold">Terminal net worth</td>
                <td className={cn("px-2 py-1.5 text-right font-semibold", result.verdict.leader === "sell" && "text-emerald-700")}>
                  {formatMoney(result.sell.terminal_net_worth, USD)}
                </td>
                <td className={cn("px-2 py-1.5 text-right font-semibold", result.verdict.leader === "borrow_monthly" && "text-emerald-700")}>
                  {formatMoney(result.borrow_monthly.terminal_net_worth, USD)}
                </td>
                <td className={cn("px-2 py-1.5 text-right font-semibold", result.verdict.leader === "borrow_capitalise" && "text-emerald-700")}>
                  {formatMoney(result.borrow_capitalise.terminal_net_worth, USD)}
                </td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Breakeven solvers */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Kpi
          label="Breakeven future tax rate"
          value={breakevenTax !== null ? `${breakevenTax.toFixed(2)} %` : "—"}
          hint={
            breakevenTax !== null
              ? `Borrow wins iff future sale rate < ${breakevenTax.toFixed(2)}%`
              : "No crossover in [0%, 100%] — sell dominates"
          }
        />
        <Kpi
          label="Breakeven SOFR (with 0% future tax)"
          value={breakevenSofr !== null ? `${breakevenSofr.toFixed(2)} %` : "—"}
          hint={
            breakevenSofr !== null
              ? `Borrow wins iff SOFR < ${breakevenSofr.toFixed(2)}%`
              : "No crossover in [0%, 20%] — sell dominates"
          }
        />
      </div>

      {/* Sweep chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Terminal net worth across future tax rates</CardTitle>
          <CardDescription>
            Holding everything else fixed, where does Sell intersect each Borrow path?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={taxSweep} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="tax_pct"
                  tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  tick={{ fontSize: 11 }}
                  label={{ value: "Future tax rate", position: "insideBottomRight", offset: -5, fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compactNumber} />
                <Tooltip
                  formatter={(v: number) => formatMoneyCompact(v, USD)}
                  labelFormatter={(l) => `Future tax ${Number(l).toFixed(1)}%`}
                />
                <Legend />
                <Line type="monotone" dataKey="sell" name="Sell now" stroke="#0ea5e9" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="borrow_monthly" name="Borrow · monthly" stroke="#f97316" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="borrow_capitalise" name="Borrow · capitalise" stroke="#10b981" dot={false} strokeWidth={2} />
                {breakevenTax !== null ? (
                  <ReferenceLine x={breakevenTax} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `Breakeven ${breakevenTax.toFixed(1)}%`, fontSize: 10, fill: "#ef4444", position: "top" }} />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Inputs snapshot for transparency */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Inputs snapshot</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <tbody>
              <tr className="border-b"><td className="px-2 py-1">Cash needed</td><td className="px-2 py-1 text-right">{formatMoney(result.inputs_snapshot.cash_needed, USD)}</td></tr>
              <tr className="border-b"><td className="px-2 py-1">Price today / horizon / repayment</td><td className="px-2 py-1 text-right">{formatMoney(result.inputs_snapshot.price_today, USD)} → {formatMoney(result.inputs_snapshot.price_horizon, USD)} (repay {formatMoney(result.inputs_snapshot.price_repayment, USD)})</td></tr>
              <tr className="border-b"><td className="px-2 py-1">Basis today / future</td><td className="px-2 py-1 text-right">{formatMoney(result.inputs_snapshot.basis_today, USD)} / {formatMoney(result.inputs_snapshot.basis_future, USD)}</td></tr>
              <tr className="border-b"><td className="px-2 py-1">Tax today / future</td><td className="px-2 py-1 text-right">{result.inputs_snapshot.tax_today_pct.toFixed(2)}% / {result.inputs_snapshot.tax_future_pct.toFixed(2)}%</td></tr>
              <tr><td className="px-2 py-1">Repayment date / horizon</td><td className="px-2 py-1 text-right">{result.inputs_snapshot.repayment_date} → {result.inputs_snapshot.horizon_date}</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ----- Small utility components -----

function DerivedValue({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-9 items-center rounded-md border border-dashed bg-muted/40 px-3 text-sm font-medium tabular-nums">
      {children}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="text-[10px] text-muted-foreground">{hint}</div> : null}
      </CardContent>
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
