"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Copy, Plus, Trash2 } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { newId } from "@/lib/models";
import { fetchLatestSofr, type SofrSnapshot } from "@/lib/sofr-feed";
import {
  RevolverScenario,
  RevolverScenarioSchema,
  computeFacility,
  computeFacilityAtBaseSofr,
  newRevolverScenario,
  type DrawEvent,
  type FacilityResult,
} from "@/lib/revolver";
import { cn, formatMoney, formatMoneyCompact, formatNumber } from "@/lib/utils";

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

// Compact tooltip/legend styling, matching Projections.
const TOOLTIP_WRAPPER_STYLE = { outline: "none" } as const;
const TOOLTIP_CONTENT_STYLE = {
  fontSize: 11,
  padding: "4px 6px",
  borderRadius: 6,
  border: "1px solid #e5e7eb",
  background: "rgba(255,255,255,0.96)",
  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
  lineHeight: "1.3",
} as const;
const TOOLTIP_LABEL_STYLE = {
  fontSize: 11,
  fontWeight: 500,
  marginBottom: 2,
  color: "#111827",
} as const;
const TOOLTIP_ITEM_STYLE = { padding: 0, margin: 0, color: "#374151" } as const;
const LEGEND_WRAPPER_STYLE = { fontSize: 11, paddingTop: 4 } as const;

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
    };
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

  const facilityMonthly = useMemo(() => computeFacility(scenario, "monthly"), [scenario]);
  const facilityCapitalise = useMemo(() => computeFacility(scenario, "capitalise"), [scenario]);
  const sofrLow = scenario.sofr_low_pct;
  const sofrHigh = scenario.sofr_high_pct;
  const facilityMonthlyLow = useMemo(
    () => (sofrLow !== undefined ? computeFacilityAtBaseSofr(scenario, "monthly", sofrLow) : null),
    [scenario, sofrLow],
  );
  const facilityMonthlyHigh = useMemo(
    () => (sofrHigh !== undefined ? computeFacilityAtBaseSofr(scenario, "monthly", sofrHigh) : null),
    [scenario, sofrHigh],
  );
  const facilityCapitaliseLow = useMemo(
    () => (sofrLow !== undefined ? computeFacilityAtBaseSofr(scenario, "capitalise", sofrLow) : null),
    [scenario, sofrLow],
  );
  const facilityCapitaliseHigh = useMemo(
    () => (sofrHigh !== undefined ? computeFacilityAtBaseSofr(scenario, "capitalise", sofrHigh) : null),
    [scenario, sofrHigh],
  );
  const facility = scenario.interest_mode === "monthly" ? facilityMonthly : facilityCapitalise;

  const isStored = stored.some((s) => s.id === scenario.id);
  const dirty = isStored ? JSON.stringify(stored.find((s) => s.id === scenario.id)) !== JSON.stringify(scenario) : true;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Revolver</h1>
          <p className="text-xs text-muted-foreground">
            Simple SBLOC-style revolving loan model — pick a draw amount and SOFR path.
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

      <ScenarioForm scenario={scenario} onChange={setScenario} />

      <FacilityView
        scenario={scenario}
        facility={facility}
        monthly={facilityMonthly}
        capitalise={facilityCapitalise}
        monthlyLow={facilityMonthlyLow}
        monthlyHigh={facilityMonthlyHigh}
        capitaliseLow={facilityCapitaliseLow}
        capitaliseHigh={facilityCapitaliseHigh}
      />

      <ScenarioComparisonView active={scenario} stored={stored} />
    </div>
  );
}

const COMPARE_COLORS = [
  "#0ea5e9", // sky
  "#f97316", // orange
  "#8b5cf6", // violet
  "#22c55e", // green
  "#e11d48", // rose
  "#eab308", // amber
  "#06b6d4", // cyan
  "#84cc16", // lime
];

function ScenarioComparisonView({
  active,
  stored,
}: {
  active: RevolverScenario;
  stored: RevolverScenario[];
}) {
  // Prefer the in-memory edited version of the active scenario over its
  // stored copy so the comparison stays live while the user tweaks inputs.
  const scenarios = useMemo(() => {
    const list = [...stored];
    const i = list.findIndex((s) => s.id === active.id);
    if (i >= 0) list[i] = active;
    else if (stored.length >= 1) list.push(active);
    return list;
  }, [stored, active]);

  const facilities = useMemo(
    () =>
      scenarios.map((s) => {
        const base = computeFacility(s, s.interest_mode);
        const low =
          s.sofr_low_pct !== undefined
            ? computeFacilityAtBaseSofr(s, s.interest_mode, s.sofr_low_pct)
            : null;
        const high =
          s.sofr_high_pct !== undefined
            ? computeFacilityAtBaseSofr(s, s.interest_mode, s.sofr_high_pct)
            : null;
        return { scenario: s, facility: base, low, high };
      }),
    [scenarios],
  );

  const hasAnyBand = useMemo(() => facilities.some((f) => f.low && f.high), [facilities]);

  const chartData = useMemo(() => {
    const dateSet = new Set<string>();
    for (const { facility } of facilities) for (const r of facility.rows) dateSet.add(r.date);
    const dates = Array.from(dateSet).sort();

    // Cumulative repayment obligation per scenario per date is just the
    // interest accrued through that date — cash paid (pay-monthly) plus
    // the compounding delta over drawn principal (capitalise). The engine
    // already tracks it per row, so no schedule math needed here.
    const cumulate = (f: FacilityResult): Map<string, number> => {
      const m = new Map<string, number>();
      for (const r of f.rows) m.set(r.date, r.cumulative_interest);
      return m;
    };

    const base = new Map<string, Map<string, number>>();
    const lo = new Map<string, Map<string, number>>();
    const hi = new Map<string, Map<string, number>>();
    for (const { scenario, facility, low, high } of facilities) {
      base.set(scenario.id, cumulate(facility));
      if (low) lo.set(scenario.id, cumulate(low));
      if (high) hi.set(scenario.id, cumulate(high));
    }

    return dates.map((date) => {
      const row: Record<string, string | number | [number, number]> = { date };
      for (const { scenario } of facilities) {
        const v = base.get(scenario.id)?.get(date);
        if (v !== undefined) row[`s_${scenario.id}`] = v;
        const l = lo.get(scenario.id)?.get(date);
        const h = hi.get(scenario.id)?.get(date);
        if (l !== undefined && h !== undefined) {
          row[`s_${scenario.id}_range`] = [Math.min(l, h), Math.max(l, h)];
        }
      }
      return row;
    });
  }, [facilities]);

  if (scenarios.length < 2) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Scenario comparison · repayment cost</CardTitle>
        <CardDescription>
          Cumulative repayment obligation over time — cash interest paid
          plus any interest folded into the balance. Each scenario uses
          its own configured mode.
          {hasAnyBand
            ? " Shaded bands span each scenario's SOFR low → high."
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-[300px] w-full">
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tickFormatter={formatMmmYY} tick={{ fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={compactNumber} />
              <Tooltip
                wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                formatter={(v: number | number[]) =>
                  Array.isArray(v)
                    ? `${formatMoney(v[0], USD, { fractionDigits: 2 })} → ${formatMoney(v[1], USD, { fractionDigits: 2 })}`
                    : formatMoney(v, USD, { fractionDigits: 2 })
                }
                labelFormatter={(l) => formatMmmYY(String(l))}
              />
              <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} iconSize={8} />
              {scenarios.map((s, i) => {
                const color = COMPARE_COLORS[i % COMPARE_COLORS.length];
                const hasBand = s.sofr_low_pct !== undefined && s.sofr_high_pct !== undefined;
                return hasBand ? (
                  <Area
                    key={`${s.id}_band`}
                    type="monotone"
                    dataKey={`s_${s.id}_range`}
                    name={`${s.name || "Untitled"} · SOFR band`}
                    stroke="none"
                    fill={color}
                    fillOpacity={0.15}
                    activeDot={false}
                    legendType="none"
                    isAnimationActive={false}
                  />
                ) : null;
              })}
              {scenarios.map((s, i) => (
                <Line
                  key={s.id}
                  type="monotone"
                  dataKey={`s_${s.id}`}
                  name={s.name || "Untitled"}
                  stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                <th className="text-left font-normal px-2 py-1.5">Scenario</th>
                <th className="text-right font-normal px-2 py-1.5">Total drawn</th>
                <th className="text-left font-normal px-2 py-1.5">Mode</th>
                <th className="text-right font-normal px-2 py-1.5">Total interest</th>
                <th className="text-right font-normal px-2 py-1.5">Ending balance</th>
                <th className="text-right font-normal px-2 py-1.5">Total repayment</th>
              </tr>
            </thead>
            <tbody>
              {facilities.map(({ scenario, facility }, i) => {
                const totalRepayment = facility.ending_balance + facility.total_cash_interest;
                const extraDraws = (scenario.draw_schedule ?? []).filter((d) => d.amount > 0).length;
                return (
                  <tr key={scenario.id} className="border-b last:border-0">
                    <td className="px-2 py-1.5">
                      <span
                        className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: COMPARE_COLORS[i % COMPARE_COLORS.length] }}
                      />
                      {scenario.name || "Untitled"}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {formatMoney(facility.total_drawn, USD)}
                      {extraDraws > 0 ? (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          ({extraDraws} draw{extraDraws === 1 ? "" : "s"})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">{facility.mode === "monthly" ? "Pay monthly" : "Capitalise"}</td>
                    <td className="px-2 py-1.5 text-right">{formatMoney(facility.total_interest, USD)}</td>
                    <td className="px-2 py-1.5 text-right">{formatMoney(facility.ending_balance, USD)}</td>
                    <td className="px-2 py-1.5 text-right">{formatMoney(totalRepayment, USD)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
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
}: {
  scenario: RevolverScenario;
  onChange: (s: RevolverScenario) => void;
}) {
  const upd = <K extends keyof RevolverScenario>(k: K, v: RevolverScenario[K]) => onChange({ ...scenario, [k]: v });

  // Live SOFR from the NY Fed Markets API. Fetched once on mount with a
  // 24h cache; the user clicks "Use" to copy it into the scenario.
  const [liveSofr, setLiveSofr] = useState<SofrSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchLatestSofr().then((snap) => {
      if (!cancelled) setLiveSofr(snap);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const refreshLiveSofr = async () => {
    setRefreshing(true);
    try {
      const snap = await fetchLatestSofr({ force: true });
      setLiveSofr(snap);
    } finally {
      setRefreshing(false);
    }
  };
  const liveDelta =
    liveSofr !== null
      ? Math.abs(scenario.sofr_base_pct - liveSofr.rate_pct) < 1e-9
      : false;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Inputs</CardTitle>
        <CardDescription>
          Loan amount, dates, interest mode, and SOFR — the balance and
          interest curves fall out of these.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Scenario name">
            <Input value={scenario.name} onChange={(e) => upd("name", e.target.value)} />
          </Field>
          <Field label="Initial draw" hint="Balance at start_date. Add later draws below.">
            <MoneyInput
              value={scenario.draw_amount}
              onChange={(n) => upd("draw_amount", Math.max(0, n))}
            />
          </Field>
          <Field label="Interest mode">
            <Select
              value={scenario.interest_mode}
              onChange={(e) => upd("interest_mode", e.target.value as RevolverScenario["interest_mode"])}
            >
              <option value="monthly">Pay monthly (cash out)</option>
              <option value="capitalise">Capitalise (balance compounds)</option>
            </Select>
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="SOFR today" hint="Drives the line on the charts.">
            <SuffixedInput
              suffix="%/yr"
              type="number"
              step={0.01}
              min={0}
              max={50}
              value={scenario.sofr_base_pct}
              onChange={(e) => upd("sofr_base_pct", Number(e.target.value))}
            />
            {liveSofr ? (
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>
                  NY Fed: <b>{liveSofr.rate_pct.toFixed(2)}%</b> as of {liveSofr.effective_date}
                </span>
                {liveDelta ? (
                  <span className="text-emerald-700">· in sync</span>
                ) : (
                  <button
                    type="button"
                    className="rounded-md border bg-background px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
                    onClick={() => upd("sofr_base_pct", liveSofr.rate_pct)}
                  >
                    Use
                  </button>
                )}
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={refreshLiveSofr}
                  disabled={refreshing}
                >
                  {refreshing ? "…" : "refresh"}
                </button>
              </div>
            ) : null}
          </Field>
          <Field label="SOFR low" hint="Blank = no band. Sets the floor of the shaded area.">
            <SuffixedInput
              suffix="%/yr"
              type="number"
              step={0.05}
              min={0}
              max={50}
              value={scenario.sofr_low_pct ?? ""}
              onChange={(e) => upd("sofr_low_pct", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </Field>
          <Field label="SOFR high" hint="Blank = no band. Sets the ceiling of the shaded area.">
            <SuffixedInput
              suffix="%/yr"
              type="number"
              step={0.05}
              min={0}
              max={50}
              value={scenario.sofr_high_pct ?? ""}
              onChange={(e) => upd("sofr_high_pct", e.target.value === "" ? undefined : Number(e.target.value))}
            />
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
        </div>

        <DrawScheduleEditor
          startDate={scenario.start_date}
          schedule={scenario.draw_schedule}
          onChange={(s) => upd("draw_schedule", s)}
        />
      </CardContent>
    </Card>
  );
}

function DrawScheduleEditor({
  startDate,
  schedule,
  onChange,
}: {
  startDate: string;
  schedule: DrawEvent[];
  onChange: (s: DrawEvent[]) => void;
}) {
  const rows = [...schedule].sort((a, b) => a.date.localeCompare(b.date));
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const addRow = () => {
    const last = rows[rows.length - 1];
    const seedDate = last?.date ?? startDate;
    onChange([...schedule, { id: newId(), date: seedDate, amount: 0 }]);
  };
  const patch = (id: string, updates: Partial<DrawEvent>) => {
    onChange(schedule.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };
  const remove = (id: string) => onChange(schedule.filter((r) => r.id !== id));

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Additional draws over time</div>
          <div className="text-[11px] text-muted-foreground">
            Each row adds to the balance at the start of the month
            containing its date.{" "}
            {rows.length > 0 ? (
              <span>Sum: <b>{formatMoney(total, USD)}</b></span>
            ) : (
              <span>None yet.</span>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" /> Add draw
        </Button>
      </div>
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <Input
                type="date"
                value={r.date}
                onChange={(e) => patch(r.id, { date: e.target.value })}
              />
              <MoneyInput
                value={r.amount}
                onChange={(n) => patch(r.id, { amount: Math.max(0, n) })}
              />
              <Button size="sm" variant="ghost" onClick={() => remove(r.id)} title="Remove this draw">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FacilityView({
  scenario,
  facility,
  monthly,
  capitalise,
  monthlyLow,
  monthlyHigh,
  capitaliseLow,
  capitaliseHigh,
}: {
  scenario: RevolverScenario;
  facility: FacilityResult;
  monthly: FacilityResult;
  capitalise: FacilityResult;
  monthlyLow: FacilityResult | null;
  monthlyHigh: FacilityResult | null;
  capitaliseLow: FacilityResult | null;
  capitaliseHigh: FacilityResult | null;
}) {
  const totalBalanceGrowth = capitalise.ending_balance - scenario.draw_amount;
  const hasBands = !!(monthlyLow || monthlyHigh || capitaliseLow || capitaliseHigh);
  const chartData = useMemo(() => {
    const len = Math.max(monthly.rows.length, capitalise.rows.length);
    type Row = {
      date: string;
      monthly_balance: number;
      cap_balance: number;
      cumulative_interest_monthly: number;
      cumulative_interest_capitalise: number;
      /** Recharts range-area expects a [lo, hi] tuple per datum. */
      monthly_balance_range?: [number, number];
      cap_balance_range?: [number, number];
      cumulative_interest_monthly_range?: [number, number];
      cumulative_interest_capitalise_range?: [number, number];
    };
    const rows: Row[] = [];
    let cumMonthly = 0;
    let cumCap = 0;
    let cumMonthlyLow = 0;
    let cumMonthlyHigh = 0;
    let cumCapLow = 0;
    let cumCapHigh = 0;
    for (let i = 0; i < len; i++) {
      const m = monthly.rows[i];
      const c = capitalise.rows[i];
      const mLo = monthlyLow?.rows[i];
      const mHi = monthlyHigh?.rows[i];
      const cLo = capitaliseLow?.rows[i];
      const cHi = capitaliseHigh?.rows[i];
      cumMonthly += m?.interest ?? 0;
      cumCap += c?.interest ?? 0;
      cumMonthlyLow += mLo?.interest ?? 0;
      cumMonthlyHigh += mHi?.interest ?? 0;
      cumCapLow += cLo?.interest ?? 0;
      cumCapHigh += cHi?.interest ?? 0;
      const row: Row = {
        date: m?.date ?? c?.date ?? "",
        monthly_balance: m?.balance_end ?? 0,
        cap_balance: c?.balance_end ?? 0,
        cumulative_interest_monthly: cumMonthly,
        cumulative_interest_capitalise: cumCap,
      };
      if (mLo && mHi) {
        row.monthly_balance_range = [mLo.balance_end, mHi.balance_end];
        row.cumulative_interest_monthly_range = [cumMonthlyLow, cumMonthlyHigh];
      }
      if (cLo && cHi) {
        row.cap_balance_range = [cLo.balance_end, cHi.balance_end];
        row.cumulative_interest_capitalise_range = [cumCapLow, cumCapHigh];
      }
      rows.push(row);
    }
    return rows;
  }, [monthly, capitalise, monthlyLow, monthlyHigh, capitaliseLow, capitaliseHigh]);

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Total interest" value={formatMoney(facility.total_interest, USD)} hint={facility.mode === "monthly" ? "Cash paid out" : "Rolled into balance"} />
        <Kpi label="Ending balance" value={formatMoney(facility.ending_balance, USD)} />
        <Kpi label="Effective all-in rate" value={`${facility.effective_annual_rate_pct.toFixed(2)} %/yr`} hint="Geometric over horizon" />
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
              <tr>
                <td className="px-2 py-1.5">Ending balance</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(monthly.ending_balance, USD)}</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(capitalise.ending_balance, USD)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Chart: balance both modes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Outstanding balance</CardTitle>
          <CardDescription>
            Pay-monthly stays flat; capitalise compounds.
            {hasBands ? " Shaded bands span SOFR low → high." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={formatMmmYY} tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compactNumber} />
                <Tooltip
                  wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v: number | number[]) =>
                    Array.isArray(v)
                      ? `${formatMoney(v[0], USD, { fractionDigits: 2 })} → ${formatMoney(v[1], USD, { fractionDigits: 2 })}`
                      : formatMoney(v, USD, { fractionDigits: 2 })
                  }
                  labelFormatter={(l) => formatMmmYY(String(l))}
                />
                <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} iconSize={8} />
                {monthlyLow && monthlyHigh ? (
                  <Area
                    type="monotone"
                    dataKey="monthly_balance_range"
                    name="Pay monthly · SOFR band"
                    stroke="none"
                    fill="#0ea5e9"
                    fillOpacity={0.18}
                    activeDot={false}
                    legendType="none"
                  />
                ) : null}
                {capitaliseLow && capitaliseHigh ? (
                  <Area
                    type="monotone"
                    dataKey="cap_balance_range"
                    name="Capitalise · SOFR band"
                    stroke="none"
                    fill="#f97316"
                    fillOpacity={0.18}
                    activeDot={false}
                    legendType="none"
                  />
                ) : null}
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
          {hasBands ? (
            <CardDescription>Shaded bands span SOFR low → high.</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            <ResponsiveContainer>
              <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tickFormatter={formatMmmYY} tick={{ fontSize: 11 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compactNumber} />
                <Tooltip
                  wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  labelStyle={TOOLTIP_LABEL_STYLE}
                  itemStyle={TOOLTIP_ITEM_STYLE}
                  formatter={(v: number | number[]) =>
                    Array.isArray(v)
                      ? `${formatMoney(v[0], USD, { fractionDigits: 2 })} → ${formatMoney(v[1], USD, { fractionDigits: 2 })}`
                      : formatMoney(v, USD, { fractionDigits: 2 })
                  }
                  labelFormatter={(l) => formatMmmYY(String(l))}
                />
                <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} iconSize={8} />
                {monthlyLow && monthlyHigh ? (
                  <Area
                    type="monotone"
                    dataKey="cumulative_interest_monthly_range"
                    name="Pay monthly · SOFR band"
                    stroke="none"
                    fill="#0ea5e9"
                    fillOpacity={0.18}
                    activeDot={false}
                    legendType="none"
                  />
                ) : null}
                {capitaliseLow && capitaliseHigh ? (
                  <Area
                    type="monotone"
                    dataKey="cumulative_interest_capitalise_range"
                    name="Capitalise · SOFR band"
                    stroke="none"
                    fill="#f97316"
                    fillOpacity={0.18}
                    activeDot={false}
                    legendType="none"
                  />
                ) : null}
                <Line type="monotone" dataKey="cumulative_interest_monthly" name="Pay monthly" stroke="#0ea5e9" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="cumulative_interest_capitalise" name="Capitalise" stroke="#f97316" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Monthly schedule</CardTitle>
          <CardDescription>Click each mode to expand the full per-month table.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Pay monthly · {monthly.rows.length} months
            </summary>
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                    <th className="text-left font-normal px-2 py-1">Date</th>
                    <th className="text-right font-normal px-2 py-1">Rate</th>
                    <th className="text-right font-normal px-2 py-1">New draw</th>
                    <th className="text-right font-normal px-2 py-1">Balance</th>
                    <th className="text-right font-normal px-2 py-1">Interest</th>
                    <th className="text-right font-normal px-2 py-1">Cash paid</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.rows.map((r) => (
                    <tr key={r.month_index} className="border-b last:border-0">
                      <td className="px-2 py-1">{formatMmmYY(r.date)}</td>
                      <td className="px-2 py-1 text-right">{r.rate_pct.toFixed(2)}%</td>
                      <td className="px-2 py-1 text-right">
                        {r.draw_added > 0 ? formatMoneyCompact(r.draw_added, USD) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right">{formatMoneyCompact(r.balance_end, USD)}</td>
                      <td className="px-2 py-1 text-right">{formatMoneyCompact(r.interest, USD)}</td>
                      <td className="px-2 py-1 text-right">{formatMoneyCompact(r.cash_paid, USD)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Capitalise · {capitalise.rows.length} months · loan grows by interest each month
            </summary>
            <div className="overflow-x-auto pt-2">
              <table className="w-full text-[11px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                    <th className="text-left font-normal px-2 py-1">Date</th>
                    <th className="text-right font-normal px-2 py-1">Rate</th>
                    <th className="text-right font-normal px-2 py-1">New draw</th>
                    <th className="text-right font-normal px-2 py-1">Interest added</th>
                    <th className="text-right font-normal px-2 py-1">Interest to date</th>
                    <th className="text-right font-normal px-2 py-1">Total loan</th>
                  </tr>
                </thead>
                <tbody>
                  {capitalise.rows.map((r) => (
                    <tr key={r.month_index} className="border-b last:border-0">
                      <td className="px-2 py-1">{formatMmmYY(r.date)}</td>
                      <td className="px-2 py-1 text-right">{r.rate_pct.toFixed(2)}%</td>
                      <td className="px-2 py-1 text-right">
                        {r.draw_added > 0 ? formatMoneyCompact(r.draw_added, USD) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right">{formatMoneyCompact(r.interest, USD)}</td>
                      <td className="px-2 py-1 text-right">
                        {formatMoneyCompact(r.cumulative_interest, USD)}
                      </td>
                      <td className="px-2 py-1 text-right">{formatMoneyCompact(r.balance_end, USD)}</td>
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
