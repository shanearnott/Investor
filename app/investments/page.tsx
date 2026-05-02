"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { formatMoney, formatNumber } from "@/lib/utils";
import {
  EQUITY_TYPES,
  PROPERTY_COUNTRIES,
  Property,
  PropertySchema,
  StockHolding,
  StockHoldingSchema,
  SUPPORTED_CURRENCIES,
  SUPPORTED_JURISDICTIONS,
  Tranche,
  VestEvent,
  newId,
  todayISO,
  totalGrantedShares,
  vestedSharesAt,
} from "@/lib/models";
import { lookupGrowthRate } from "@/lib/growth";

type StockDraft = StockHolding;
type PropertyDraft = Property;

function blankStock(defaultJurisdiction: string): StockDraft {
  return StockHoldingSchema.parse({
    id: newId(),
    ticker: "",
    company_name: "",
    equity_type: "Common Stock",
    currency: "USD",
    jurisdiction: defaultJurisdiction,
    current_share_price: 0,
    cost_basis_per_share: 0,
    shares_owned_outright: 0,
    tranches: [],
    notes: "",
  });
}

function blankTranche(): Tranche {
  return {
    id: newId(),
    name: "",
    grant_date: null,
    vest_events: [],
    notes: "",
  };
}

function trancheTotalShares(t: Tranche): number {
  return t.vest_events.reduce((s, ev) => s + ev.shares, 0);
}

function blankProperty(defaultJurisdiction: string): PropertyDraft {
  return PropertySchema.parse({
    id: newId(),
    name: "",
    address: "",
    suburb: "",
    region: "",
    country: "United States",
    postcode: "",
    purchase_price: 0,
    purchase_date: null,
    current_value: 0,
    annual_growth_pct: 4,
    mortgage_balance: 0,
    currency: "USD",
    jurisdiction: defaultJurisdiction,
    notes: "",
  });
}

export default function InvestmentsPage() {
  const { data, setStocks, setProperties } = useData();
  const [tab, setTab] = useState<"stocks" | "properties">("stocks");
  const [editingStock, setEditingStock] = useState<StockDraft | null>(null);
  const [editingProp, setEditingProp] = useState<PropertyDraft | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Investments</h1>
        <div className="flex rounded-md border bg-card text-sm">
          <button
            className={`px-3 py-1.5 ${tab === "stocks" ? "bg-secondary" : ""}`}
            onClick={() => setTab("stocks")}
          >
            Stocks
          </button>
          <button
            className={`px-3 py-1.5 ${tab === "properties" ? "bg-secondary" : ""}`}
            onClick={() => setTab("properties")}
          >
            Properties
          </button>
        </div>
      </div>

      {tab === "stocks" ? (
        <StocksSection
          stocks={data.stocks}
          defaultJurisdiction={data.settings.default_jurisdiction}
          editing={editingStock}
          startEdit={setEditingStock}
          onSave={async (h) => {
            const exists = data.stocks.findIndex((x) => x.id === h.id);
            const next = [...data.stocks];
            if (exists >= 0) next[exists] = h;
            else next.push(h);
            await setStocks(next);
            setEditingStock(null);
          }}
          onDelete={async (id) => setStocks(data.stocks.filter((s) => s.id !== id))}
        />
      ) : (
        <PropertiesSection
          properties={data.properties}
          defaultJurisdiction={data.settings.default_jurisdiction}
          editing={editingProp}
          startEdit={setEditingProp}
          onSave={async (p) => {
            const exists = data.properties.findIndex((x) => x.id === p.id);
            const next = [...data.properties];
            if (exists >= 0) next[exists] = p;
            else next.push(p);
            await setProperties(next);
            setEditingProp(null);
          }}
          onDelete={async (id) => setProperties(data.properties.filter((p) => p.id !== id))}
        />
      )}
    </div>
  );
}

function StocksSection(props: {
  stocks: StockHolding[];
  defaultJurisdiction: string;
  editing: StockDraft | null;
  startEdit: (s: StockDraft | null) => void;
  onSave: (h: StockDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { stocks, defaultJurisdiction, editing, startEdit, onSave, onDelete } = props;
  const today = new Date();
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => startEdit(blankStock(defaultJurisdiction))}>
          <Plus className="h-4 w-4" /> Add stock
        </Button>
      </div>

      <div className="grid gap-3">
        {stocks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No stocks yet.
            </CardContent>
          </Card>
        ) : (
          stocks.map((h) => (
            <Card key={h.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base">
                    {h.ticker || h.company_name || "(unnamed)"}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      · {h.equity_type}
                    </span>
                  </CardTitle>
                  <CardDescription>
                    {formatNumber(totalGrantedShares(h))} sh @{" "}
                    {formatMoney(h.current_share_price, h.currency, { fractionDigits: 2 })} ·{" "}
                    {h.jurisdiction}
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => startEdit({ ...h })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(h.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                <div>
                  Vested today: <b>{formatNumber(vestedSharesAt(h, today))}</b> sh · Cost basis:{" "}
                  {formatMoney(h.cost_basis_per_share, h.currency, { fractionDigits: 2 })} / sh
                </div>
                {h.notes ? <div className="text-muted-foreground italic">{h.notes}</div> : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {editing ? (
        <StockForm
          draft={editing}
          onCancel={() => startEdit(null)}
          onSave={onSave}
        />
      ) : null}
    </div>
  );
}

function StockForm({
  draft,
  onCancel,
  onSave,
}: {
  draft: StockDraft;
  onCancel: () => void;
  onSave: (h: StockDraft) => Promise<void>;
}) {
  const [d, setD] = useState<StockDraft>(draft);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof StockDraft>(k: K, v: StockDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const addTranche = () =>
    setD((prev) => ({ ...prev, tranches: [...prev.tranches, blankTranche()] }));

  const removeTranche = (trancheId: string) =>
    setD((prev) => ({
      ...prev,
      tranches: prev.tranches.filter((t) => t.id !== trancheId),
    }));

  const updateTranche = (trancheId: string, patch: Partial<Tranche>) =>
    setD((prev) => ({
      ...prev,
      tranches: prev.tranches.map((t) => (t.id === trancheId ? { ...t, ...patch } : t)),
    }));

  const replaceTrancheEvents = (trancheId: string, events: VestEvent[]) =>
    updateTranche(trancheId, { vest_events: events });

  const addEvent = (trancheId: string) =>
    setD((prev) => ({
      ...prev,
      tranches: prev.tranches.map((t) =>
        t.id === trancheId
          ? { ...t, vest_events: [...t.vest_events, { vest_date: todayISO(), shares: 0 }] }
          : t,
      ),
    }));

  const updateEvent = (trancheId: string, idx: number, ev: VestEvent) =>
    setD((prev) => ({
      ...prev,
      tranches: prev.tranches.map((t) => {
        if (t.id !== trancheId) return t;
        const next = [...t.vest_events];
        next[idx] = ev;
        return { ...t, vest_events: next };
      }),
    }));

  const removeEvent = (trancheId: string, idx: number) =>
    setD((prev) => ({
      ...prev,
      tranches: prev.tranches.map((t) =>
        t.id === trancheId
          ? { ...t, vest_events: t.vest_events.filter((_, i) => i !== idx) }
          : t,
      ),
    }));

  const submit = async () => {
    setError(null);
    // Drop empty events; keep tranches even if they have no events (user may
    // be in the middle of setting one up but pressed Save).
    const cleaned = {
      ...d,
      ticker: d.ticker.trim().toUpperCase(),
      tranches: d.tranches.map((t) => ({
        ...t,
        vest_events: t.vest_events.filter((ev) => ev.shares > 0 && ev.vest_date),
      })),
    };
    const parsed = StockHoldingSchema.safeParse(cleaned);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    await onSave(parsed.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{draft.ticker ? `Edit ${draft.ticker}` : "Add a stock"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Ticker">
            <Input value={d.ticker} onChange={(e) => update("ticker", e.target.value)} placeholder="ACME" />
          </Field>
          <Field label="Company">
            <Input value={d.company_name} onChange={(e) => update("company_name", e.target.value)} />
          </Field>
          <Field label="Equity type">
            <Select value={d.equity_type} onChange={(e) => update("equity_type", e.target.value as StockHolding["equity_type"]) }>
              {EQUITY_TYPES.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={d.currency} onChange={(e) => update("currency", e.target.value as StockHolding["currency"])}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Jurisdiction">
            <Select value={d.jurisdiction} onChange={(e) => update("jurisdiction", e.target.value as StockHolding["jurisdiction"])}>
              {SUPPORTED_JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
            </Select>
          </Field>
          <Field label="Current share price">
            <Input type="number" step="0.01" value={d.current_share_price} onChange={(e) => update("current_share_price", Number(e.target.value))} />
          </Field>
          <Field label="Cost basis / share">
            <Input type="number" step="0.01" value={d.cost_basis_per_share} onChange={(e) => update("cost_basis_per_share", Number(e.target.value))} />
          </Field>
          <Field label="Shares owned outright">
            <Input type="number" step="1" value={d.shares_owned_outright} onChange={(e) => update("shares_owned_outright", Number(e.target.value))} />
          </Field>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Vesting tranches</Label>
              <p className="text-[11px] text-muted-foreground">
                Each tranche (e.g. hire grant, refresher) has its own vesting schedule.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={addTranche}>
              <Plus className="h-3 w-3" /> Add tranche
            </Button>
          </div>

          {d.tranches.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No tranches yet — click <b>Add tranche</b> to start.
            </p>
          ) : (
            <div className="space-y-3">
              {d.tranches.map((t) => (
                <TrancheEditor
                  key={t.id}
                  tranche={t}
                  onChange={(patch) => updateTranche(t.id, patch)}
                  onDelete={() => removeTranche(t.id)}
                  onReplaceEvents={(evs) => replaceTrancheEvents(t.id, evs)}
                  onAddEvent={() => addEvent(t.id)}
                  onUpdateEvent={(idx, ev) => updateEvent(t.id, idx, ev)}
                  onRemoveEvent={(idx) => removeEvent(t.id, idx)}
                />
              ))}
            </div>
          )}
        </div>

        <Field label="Notes">
          <Textarea value={d.notes} onChange={(e) => update("notes", e.target.value)} />
        </Field>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
      <div className="flex justify-end gap-2 p-4 sm:p-6 pt-0">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit}>Save</Button>
      </div>
    </Card>
  );
}

function PropertiesSection(props: {
  properties: Property[];
  defaultJurisdiction: string;
  editing: PropertyDraft | null;
  startEdit: (p: PropertyDraft | null) => void;
  onSave: (p: PropertyDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { properties, defaultJurisdiction, editing, startEdit, onSave, onDelete } = props;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => startEdit(blankProperty(defaultJurisdiction))}>
          <Plus className="h-4 w-4" /> Add property
        </Button>
      </div>

      <div className="grid gap-3">
        {properties.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No properties yet.
            </CardContent>
          </Card>
        ) : (
          properties.map((p) => {
            const provider = lookupGrowthRate({
              country: p.country,
              region: p.region,
              suburb: p.suburb,
              postcode: p.postcode,
              fallback_pct: p.annual_growth_pct,
            });
            return (
              <Card key={p.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base">{p.name || "(unnamed)"}</CardTitle>
                    <CardDescription>
                      {p.suburb}, {p.region}, {p.country} ·{" "}
                      {formatMoney(p.current_value, p.currency)}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => startEdit({ ...p })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(p.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="text-xs space-y-1">
                  <div>
                    Equity: <b>{formatMoney(p.current_value - p.mortgage_balance, p.currency)}</b>{" "}
                    · Mortgage: {formatMoney(p.mortgage_balance, p.currency)}
                  </div>
                  <div>
                    Growth: <b>{provider.rate.toFixed(2)}%/yr</b>{" "}
                    <span className="text-muted-foreground">(source: {provider.source})</span>
                  </div>
                  {p.notes ? <div className="text-muted-foreground italic">{p.notes}</div> : null}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {editing ? (
        <PropertyForm draft={editing} onCancel={() => startEdit(null)} onSave={onSave} />
      ) : null}
    </div>
  );
}

function PropertyForm({
  draft,
  onCancel,
  onSave,
}: {
  draft: PropertyDraft;
  onCancel: () => void;
  onSave: (p: PropertyDraft) => Promise<void>;
}) {
  const [d, setD] = useState<PropertyDraft>(draft);
  const [error, setError] = useState<string | null>(null);
  const update = <K extends keyof PropertyDraft>(k: K, v: PropertyDraft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const provider = lookupGrowthRate({
    country: d.country,
    region: d.region,
    suburb: d.suburb,
    postcode: d.postcode,
    fallback_pct: d.annual_growth_pct,
  });

  const submit = async () => {
    setError(null);
    const parsed = PropertySchema.safeParse({
      ...d,
      purchase_date: d.purchase_date?.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    await onSave(parsed.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{draft.name ? `Edit ${draft.name}` : "Add a property"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Name">
            <Input value={d.name} onChange={(e) => update("name", e.target.value)} placeholder="Sydney apartment" />
          </Field>
          <Field label="Country">
            <Select value={d.country} onChange={(e) => update("country", e.target.value as Property["country"])}>
              {PROPERTY_COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Region / state">
            <Input value={d.region} onChange={(e) => update("region", e.target.value)} placeholder="NSW" />
          </Field>
          <Field label="Suburb / city">
            <Input value={d.suburb} onChange={(e) => update("suburb", e.target.value)} />
          </Field>
          <Field label="Postcode / ZIP">
            <Input value={d.postcode} onChange={(e) => update("postcode", e.target.value)} />
          </Field>
          <Field label="Address">
            <Input value={d.address} onChange={(e) => update("address", e.target.value)} />
          </Field>
          <Field label="Currency">
            <Select value={d.currency} onChange={(e) => update("currency", e.target.value as Property["currency"])}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Jurisdiction">
            <Select value={d.jurisdiction} onChange={(e) => update("jurisdiction", e.target.value as Property["jurisdiction"])}>
              {SUPPORTED_JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
            </Select>
          </Field>
          <Field label="Purchase date">
            <Input type="date" value={d.purchase_date ?? ""} onChange={(e) => update("purchase_date", e.target.value || null)} />
          </Field>
          <Field label="Purchase price">
            <Input type="number" step="1000" value={d.purchase_price} onChange={(e) => update("purchase_price", Number(e.target.value))} />
          </Field>
          <Field label="Current value">
            <Input type="number" step="1000" value={d.current_value} onChange={(e) => update("current_value", Number(e.target.value))} />
          </Field>
          <Field label="Mortgage balance">
            <Input type="number" step="1000" value={d.mortgage_balance} onChange={(e) => update("mortgage_balance", Number(e.target.value))} />
          </Field>
          <Field label="Manual growth %/yr" hint={`Resolved: ${provider.rate.toFixed(2)}% via ${provider.source}`}>
            <Input type="number" step="0.1" value={d.annual_growth_pct} onChange={(e) => update("annual_growth_pct", Number(e.target.value))} />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea value={d.notes} onChange={(e) => update("notes", e.target.value)} />
        </Field>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
      <div className="flex justify-end gap-2 p-4 sm:p-6 pt-0">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit}>Save</Button>
      </div>
    </Card>
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

/**
 * Editor for one tranche: name, grant date, schedule generator, vest events.
 *
 * Collapsed view shows just the headline (name + total shares + date range)
 * so a stock with several already-set-up tranches doesn't bury the form in a
 * wall of vest rows. Newly added tranches start expanded; once the user
 * generates a schedule, we auto-collapse to the summary.
 */
function TrancheEditor({
  tranche,
  onChange,
  onDelete,
  onReplaceEvents,
  onAddEvent,
  onUpdateEvent,
  onRemoveEvent,
}: {
  tranche: Tranche;
  onChange: (patch: Partial<Tranche>) => void;
  onDelete: () => void;
  onReplaceEvents: (events: VestEvent[]) => void;
  onAddEvent: () => void;
  onUpdateEvent: (idx: number, ev: VestEvent) => void;
  onRemoveEvent: (idx: number) => void;
}) {
  const total = trancheTotalShares(tranche);
  const [collapsed, setCollapsed] = useState<boolean>(tranche.vest_events.length > 0);

  const summary = useMemo(() => {
    if (tranche.vest_events.length === 0) return null;
    const dates = tranche.vest_events.map((e) => e.vest_date).sort();
    return {
      count: tranche.vest_events.length,
      first: dates[0],
      last: dates[dates.length - 1],
    };
  }, [tranche.vest_events]);

  if (collapsed) {
    return (
      <div className="rounded-md border bg-card/50 p-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left"
          onClick={() => setCollapsed(false)}
        >
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              {tranche.name || "(unnamed tranche)"}
            </div>
            <div className="text-xs text-muted-foreground">
              {summary ? (
                <>{formatNumber(total)} sh · {summary.count} events · {summary.first} → {summary.last}</>
              ) : (
                "No vest events yet"
              )}
            </div>
          </div>
        </button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Delete tranche">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card/50 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setCollapsed(true)}
        >
          <ChevronDown className="h-4 w-4" /> Hide schedule
        </button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Delete tranche">
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:items-end">
        <Field label="Tranche name">
          <Input
            value={tranche.name}
            placeholder="e.g. 2024 hire grant"
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>
        <Field label="Grant date" hint="Used for long-term capital gains start.">
          <Input
            type="date"
            value={tranche.grant_date ?? ""}
            onChange={(e) => onChange({ grant_date: e.target.value || null })}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {tranche.vest_events.length === 0
            ? "No vest events yet."
            : <>{tranche.vest_events.length} events · {formatNumber(total)} shares total</>}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onAddEvent}>
            <Plus className="h-3 w-3" /> Add event
          </Button>
        </div>
      </div>

      <ScheduleGenerator
        empty={tranche.vest_events.length === 0}
        onGenerate={(evs) => {
          onReplaceEvents(evs);
          setCollapsed(true);
        }}
      />

      {tranche.vest_events.length > 0 ? (
        <div className="space-y-1">
          {tranche.vest_events.map((ev, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                type="date"
                value={ev.vest_date}
                onChange={(e) => onUpdateEvent(idx, { ...ev, vest_date: e.target.value })}
              />
              <Input
                type="number"
                step="1"
                value={ev.shares}
                onChange={(e) => onUpdateEvent(idx, { ...ev, shares: Number(e.target.value) })}
              />
              <Button size="icon" variant="ghost" onClick={() => onRemoveEvent(idx)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <Field label="Tranche notes">
        <Input
          value={tranche.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="optional"
        />
      </Field>
    </div>
  );
}

/**
 * Helper to generate a vesting schedule from a few inputs:
 * total shares, start date (first event = end of cliff), full vest duration
 * in years, and the period (monthly/quarterly/yearly). Splits total evenly
 * across the resulting number of events. If total isn't divisible, the
 * leftover whole shares are added to the final event so the sum matches
 * exactly. Replaces the tranche's existing vest events.
 */
function ScheduleGenerator({
  empty,
  onGenerate,
}: {
  empty: boolean;
  onGenerate: (events: VestEvent[]) => void;
}) {
  const [open, setOpen] = useState<boolean>(empty);
  const [total, setTotal] = useState<number>(0);
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [years, setYears] = useState<number>(4);
  const [period, setPeriod] = useState<"monthly" | "quarterly" | "yearly">("quarterly");
  const [error, setError] = useState<string | null>(null);

  const periodsPerYear = { monthly: 12, quarterly: 4, yearly: 1 }[period];
  const totalPeriods = Math.max(1, Math.round(years * periodsPerYear));
  const monthsStep = 12 / periodsPerYear;
  const previewPerEvent = total > 0 ? Math.floor(total / totalPeriods) : 0;
  const previewLastEvent = total > 0 ? previewPerEvent + (total - previewPerEvent * totalPeriods) : 0;

  const generate = () => {
    setError(null);
    if (!total || total <= 0) {
      setError("Enter a total share count.");
      return;
    }
    const start = new Date(startDate + "T00:00:00Z");
    if (isNaN(start.getTime())) {
      setError("Invalid start date.");
      return;
    }
    const events: VestEvent[] = [];
    const baseShares = Math.floor(total / totalPeriods);
    const remainder = total - baseShares * totalPeriods;
    for (let i = 0; i < totalPeriods; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i * monthsStep, start.getUTCDate()));
      const shares = i === totalPeriods - 1 ? baseShares + remainder : baseShares;
      events.push({ vest_date: d.toISOString().slice(0, 10), shares });
    }
    onGenerate(events);
    setOpen(false);
  };

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        ⚙ Generate schedule from total + dates…
      </Button>
    );
  }

  return (
    <div className="rounded-md border bg-secondary/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Generate schedule for this tranche</Label>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setOpen(false)}>
          hide
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Total shares" hint="Sum across all events">
          <Input
            type="number"
            step="1"
            min={0}
            value={total || ""}
            placeholder="e.g. 4000"
            onChange={(e) => setTotal(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Start date" hint="First event vests on this date (end of cliff)">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Years to fully vest">
          <Input
            type="number"
            step="0.25"
            min={0.25}
            value={years}
            onChange={(e) => setYears(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Period">
          <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
            <option value="monthly">monthly</option>
            <option value="quarterly">quarterly</option>
            <option value="yearly">yearly</option>
          </Select>
        </Field>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Will create <b>{totalPeriods}</b> events of <b>{formatNumber(previewPerEvent)}</b> shares each
        {previewLastEvent !== previewPerEvent ? <> (last event: <b>{formatNumber(previewLastEvent)}</b>)</> : null}
        , every {monthsStep === 1 ? "month" : monthsStep === 3 ? "3 months" : "12 months"}.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" onClick={generate}>
          Generate (replaces this tranche&apos;s events)
        </Button>
      </div>
    </div>
  );
}
