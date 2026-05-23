"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { convert } from "@/lib/fx";
import { formatMoney, formatNumber } from "@/lib/utils";
import {
  EQUITY_TYPES,
  PROPERTY_COUNTRIES,
  Property,
  PropertySchema,
  StockHolding,
  StockHoldingSale,
  StockHoldingSchema,
  SUPPORTED_CURRENCIES,
  SUPPORTED_JURISDICTIONS,
  Tranche,
  VestEvent,
  newId,
  parseISO,
  type Settings,
  todayISO,
  totalGrantedShares,
  vestEventNetShares,
  vestedSharesAt,
} from "@/lib/models";
import { lookupGrowthRate } from "@/lib/growth";

type StockDraft = StockHolding;
type PropertyDraft = Property;

/** Scroll an inline edit form into view when it mounts so the user sees it
 *  appear directly under the row they clicked. Slight delay so layout settles. */
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
  return t.vest_events.reduce((s, ev) => s + vestEventNetShares(ev), 0);
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
  const [editingStock, setEditingStock] = useState<StockDraft | null>(null);
  const [editingProp, setEditingProp] = useState<PropertyDraft | null>(null);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <h1 className="text-xl font-semibold">Investments</h1>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-2 border-b pb-2">
          <div>
            <h2 className="text-lg font-semibold">📊 Stocks &amp; equity</h2>
            <p className="text-xs text-muted-foreground">
              {data.stocks.length === 0
                ? "No stocks yet."
                : `${data.stocks.length} holding${data.stocks.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
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

        <RecordedSalesSummary stocks={data.stocks} settings={data.settings} />
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-2 border-b pb-2">
          <div>
            <h2 className="text-lg font-semibold">🏠 Properties</h2>
            <p className="text-xs text-muted-foreground">
              {data.properties.length === 0
                ? "No properties yet."
                : `${data.properties.length} propert${data.properties.length === 1 ? "y" : "ies"}`}
            </p>
          </div>
        </div>
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
      </section>
    </div>
  );
}

function RecordedSalesSummary({
  stocks,
  settings,
}: {
  stocks: StockHolding[];
  settings: Settings;
}) {
  const display = settings.primary_currency;
  const rows = stocks
    .map((h) => {
      const sales = h.sales ?? [];
      if (sales.length === 0) return null;
      let shares = 0;
      let grossNative = 0;
      let taxNative = 0;
      for (const s of sales) {
        const price = s.sale_price !== undefined && s.sale_price > 0 ? s.sale_price : h.current_share_price;
        const g = s.shares * price;
        const cover = Math.min(s.sell_to_cover_shares ?? 0, s.shares);
        const taxForEvent = cover > 0
          ? cover * price
          : g * (Math.min(100, Math.max(0, s.tax_rate_pct)) / 100);
        shares += s.shares;
        grossNative += g;
        taxNative += taxForEvent;
      }
      if (shares === 0) return null;
      const gross = convert(grossNative, h.currency, display, settings);
      const tax = convert(taxNative, h.currency, display, settings);
      return {
        id: h.id,
        label: h.ticker || h.company_name || "—",
        shares,
        gross,
        tax,
        net: gross - tax,
        ratePct: grossNative > 0 ? (taxNative / grossNative) * 100 : 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (rows.length === 0) return null;
  const total = rows.reduce(
    (acc, r) => ({
      shares: acc.shares + r.shares,
      gross: acc.gross + r.gross,
      tax: acc.tax + r.tax,
      net: acc.net + r.net,
    }),
    { shares: 0, gross: 0, tax: 0, net: 0 },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recorded sales</CardTitle>
        <CardDescription>
          Sale events you&apos;ve logged on each stock. Informational only — cash isn&apos;t rolled into net worth.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border divide-y">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <div>Stock</div>
            <div className="text-right">Shares</div>
            <div className="text-right">Gross</div>
            <div className="text-right">Tax</div>
            <div className="text-right">Net</div>
          </div>
          {rows.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[1fr_auto_auto_auto_auto] items-baseline gap-3 px-3 py-1.5 text-xs tabular-nums"
            >
              <div className="font-medium">{r.label}</div>
              <div className="text-right">{formatNumber(r.shares)}</div>
              <div className="text-right">{formatMoney(r.gross, display)}</div>
              <div className="text-right text-muted-foreground">
                −{formatMoney(r.tax, display)}
                <span className="ml-1 text-[10px]">({r.ratePct.toFixed(1)}%)</span>
              </div>
              <div className="text-right font-semibold">{formatMoney(r.net, display)}</div>
            </div>
          ))}
          {rows.length > 1 ? (
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-baseline gap-3 px-3 py-1.5 text-xs tabular-nums bg-muted/40">
              <div className="font-medium">Total</div>
              <div className="text-right">{formatNumber(total.shares)}</div>
              <div className="text-right">{formatMoney(total.gross, display)}</div>
              <div className="text-right text-muted-foreground">
                −{formatMoney(total.tax, display)}
              </div>
              <div className="text-right font-semibold">{formatMoney(total.net, display)}</div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
            <Fragment key={h.id}>
              <Card>
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
                    <Button
                      size="sm"
                      variant={editing?.id === h.id ? "default" : "outline"}
                      onClick={() => startEdit(editing?.id === h.id ? null : { ...h })}
                    >
                      {editing?.id === h.id ? "Close" : "Edit"}
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
              {editing?.id === h.id ? (
                <StockForm
                  key={editing.id}
                  draft={editing}
                  onCancel={() => startEdit(null)}
                  onSave={onSave}
                />
              ) : null}
            </Fragment>
          ))
        )}
      </div>

      {editing && !stocks.some((s) => s.id === editing.id) ? (
        <StockForm
          key={editing.id}
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
  const cardRef = useScrollIntoViewOnMount<HTMLDivElement>();

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
          ? { ...t, vest_events: [...t.vest_events, { vest_date: todayISO(), shares: 0, sell_to_cover_shares: 0, tax_rate_pct: 0 }] }
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

  const addSale = () =>
    setD((prev) => ({
      ...prev,
      sales: [
        ...(prev.sales ?? []),
        {
          id: newId(),
          release_date: todayISO(),
          shares: 0,
          tax_rate_pct: 0,
          sell_to_cover_shares: 0,
          notes: "",
        },
      ],
    }));

  const updateSale = (
    id: string,
    patch: Partial<{
      release_date: string;
      sell_date: string;
      sale_price: number | undefined;
      shares: number;
      tax_rate_pct: number;
      sell_to_cover_shares: number;
      notes: string;
    }>,
  ) =>
    setD((prev) => ({
      ...prev,
      sales: (prev.sales ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));

  const removeSale = (id: string) =>
    setD((prev) => ({
      ...prev,
      sales: (prev.sales ?? []).filter((s) => s.id !== id),
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
    <Card ref={cardRef} className="scroll-mt-24 ring-2 ring-primary/20">
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
          <Field
            label="Shares owned outright"
            hint={(() => {
              const today = new Date();
              const extra = (d.sales ?? []).reduce((acc, s) => {
                if (s.sell_date) return acc;
                const release = parseISO(s.release_date);
                if (!release || release > today) return acc;
                const cover = Math.min(s.sell_to_cover_shares ?? 0, s.shares);
                return acc + Math.max(0, s.shares - cover);
              }, 0);
              if (extra <= 0) return undefined;
              const total = d.shares_owned_outright + extra;
              return `Base ${formatNumber(d.shares_owned_outright)} + ${formatNumber(extra)} from un-sold releases = ${formatNumber(total)} total.`;
            })()}
          >
            <Input
              type="number"
              step="1"
              value={d.shares_owned_outright}
              onChange={(e) => update("shares_owned_outright", Number(e.target.value))}
            />
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

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label>Recorded sales</Label>
              <p className="text-[11px] text-muted-foreground">
                Sales of vested shares — historical or committed. On the release
                date the shares come out of the vested count. The cash proceeds
                are recorded here for reference but don&apos;t roll into net worth.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={addSale}>
              <Plus className="h-3 w-3" /> Add sale
            </Button>
          </div>

          {(d.sales ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No sales recorded — click <b>Add sale</b> to log one.
            </p>
          ) : (
            <div className="space-y-2">
              {(d.sales ?? []).map((s) => (
                <SaleEditor
                  key={s.id}
                  sale={s}
                  currency={d.currency}
                  currentSharePrice={d.current_share_price}
                  onChange={(patch) => updateSale(s.id, patch)}
                  onDelete={() => removeSale(s.id)}
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
              <Fragment key={p.id}>
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                    <div>
                      <CardTitle className="text-base">{p.name || "(unnamed)"}</CardTitle>
                      <CardDescription>
                        {p.suburb}, {p.region}, {p.country} ·{" "}
                        {formatMoney(p.current_value, p.currency)}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant={editing?.id === p.id ? "default" : "outline"}
                        onClick={() => startEdit(editing?.id === p.id ? null : { ...p })}
                      >
                        {editing?.id === p.id ? "Close" : "Edit"}
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
                {editing?.id === p.id ? (
                  <PropertyForm
                    key={editing.id}
                    draft={editing}
                    onCancel={() => startEdit(null)}
                    onSave={onSave}
                  />
                ) : null}
              </Fragment>
            );
          })
        )}
      </div>

      {editing && !properties.some((p) => p.id === editing.id) ? (
        <PropertyForm
          key={editing.id}
          draft={editing}
          onCancel={() => startEdit(null)}
          onSave={onSave}
        />
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
  const cardRef = useScrollIntoViewOnMount<HTMLDivElement>();
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
    <Card ref={cardRef} className="scroll-mt-24 ring-2 ring-primary/20">
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

function SaleEditor({
  sale,
  currency,
  currentSharePrice,
  onChange,
  onDelete,
}: {
  sale: StockHoldingSale;
  currency: string;
  currentSharePrice: number;
  onChange: (patch: Partial<{
    release_date: string;
    sell_date: string;
    sale_price: number | undefined;
    shares: number;
    tax_rate_pct: number;
    sell_to_cover_shares: number;
    notes: string;
  }>) => void;
  onDelete: () => void;
}) {
  // Tax can be specified two ways: a percent rate, or a count of shares
  // sold-to-cover. Sell-to-cover takes precedence when > 0.
  const coverMode = (sale.sell_to_cover_shares ?? 0) > 0;
  const [taxMode, setTaxMode] = useState<"pct" | "cover">(coverMode ? "cover" : "pct");
  const price = sale.sale_price && sale.sale_price > 0 ? sale.sale_price : currentSharePrice;
  const effectiveRate = coverMode && sale.shares > 0
    ? (Math.min(sale.sell_to_cover_shares ?? 0, sale.shares) / sale.shares) * 100
    : sale.tax_rate_pct;
  const heldOutright = !sale.sell_date
    ? Math.max(0, sale.shares - Math.min(sale.sell_to_cover_shares ?? 0, sale.shares))
    : 0;
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Release date" hint="When the shares came off vesting.">
          <Input
            type="date"
            value={sale.release_date}
            onChange={(e) => onChange({ release_date: e.target.value })}
          />
        </Field>
        <Field
          label="Sell date"
          hint="Blank = the non-cover shares were kept (owned outright)."
        >
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={sale.sell_date ?? ""}
              onChange={(e) => onChange({ sell_date: e.target.value || undefined })}
            />
            {sale.sell_date ? (
              <Button
                size="icon"
                variant="ghost"
                title="Clear sell date"
                onClick={() => onChange({ sell_date: undefined })}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Shares" hint="Total shares released in this event.">
          <Input
            type="number"
            step="1"
            min={0}
            value={sale.shares}
            onChange={(e) => onChange({ shares: Number(e.target.value) })}
          />
        </Field>
        <Field label={`Share price (${currency})`} hint="Blank = current share price.">
          <Input
            type="number"
            step="0.01"
            min={0}
            value={sale.sale_price ?? ""}
            onChange={(e) =>
              onChange({ sale_price: e.target.value === "" ? undefined : Number(e.target.value) })
            }
          />
        </Field>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label>Tax for this event</Label>
            <Select
              className="h-7 w-auto text-xs"
              value={taxMode}
              onChange={(e) => {
                const next = e.target.value as "pct" | "cover";
                setTaxMode(next);
                if (next === "pct") {
                  onChange({ sell_to_cover_shares: 0 });
                } else {
                  onChange({ tax_rate_pct: 0 });
                }
              }}
            >
              <option value="pct">% rate</option>
              <option value="cover">Sell to cover</option>
            </Select>
          </div>
          {taxMode === "pct" ? (
            <>
              <Input
                type="number"
                step="0.5"
                min={0}
                max={100}
                value={sale.tax_rate_pct}
                onChange={(e) =>
                  onChange({ tax_rate_pct: Number(e.target.value), sell_to_cover_shares: 0 })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Tax ≈ {formatMoney(sale.shares * price * (sale.tax_rate_pct / 100), currency)} on{" "}
                {formatMoney(sale.shares * price, currency)} gross.
              </p>
            </>
          ) : (
            <>
              <Input
                type="number"
                step="1"
                min={0}
                value={sale.sell_to_cover_shares ?? 0}
                onChange={(e) =>
                  onChange({ sell_to_cover_shares: Number(e.target.value), tax_rate_pct: 0 })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                ≈ {formatMoney((sale.sell_to_cover_shares ?? 0) * price, currency)} tax
                ({effectiveRate.toFixed(1)}% effective).
              </p>
            </>
          )}
        </div>
      </div>
      {heldOutright > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {formatNumber(heldOutright)} share{heldOutright === 1 ? "" : "s"} held outright after
          this event (sell date blank, cover taken out).
        </p>
      ) : null}
      <Field label="Notes (optional)">
        <Input
          value={sale.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Field>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Trash2 className="h-4 w-4" /> Remove
        </Button>
      </div>
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
          <div className="grid grid-cols-[minmax(7rem,12rem)_1fr_1fr_1fr_1fr_auto] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground px-1">
            <div>Vest date</div>
            <div>Shares</div>
            <div title="Shares the broker auto-sold to cover tax at vest. Takes precedence over Tax %.">
              Sell to cover
            </div>
            <div title="Tax rate as % of gross shares — applied when Sell-to-cover is 0.">
              Tax %
            </div>
            <div className="text-right" title="Shares the user actually receives (shares − cover or − shares × tax%).">
              Net
            </div>
            <div />
          </div>
          {tranche.vest_events.map((ev, idx) => {
            const net = vestEventNetShares(ev);
            return (
              <div
                key={idx}
                className="grid grid-cols-[minmax(7rem,12rem)_1fr_1fr_1fr_1fr_auto] gap-2 items-center"
              >
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
                <Input
                  type="number"
                  step="1"
                  min={0}
                  value={ev.sell_to_cover_shares ?? 0}
                  onChange={(e) =>
                    onUpdateEvent(idx, { ...ev, sell_to_cover_shares: Number(e.target.value) })
                  }
                />
                <Input
                  type="number"
                  step="0.5"
                  min={0}
                  max={100}
                  value={ev.tax_rate_pct ?? 0}
                  onChange={(e) =>
                    onUpdateEvent(idx, { ...ev, tax_rate_pct: Number(e.target.value) })
                  }
                />
                <div className="text-right text-xs tabular-nums text-muted-foreground px-1">
                  {formatNumber(Math.round(net))}
                </div>
                <Button size="icon" variant="ghost" onClick={() => onRemoveEvent(idx)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
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
      events.push({ vest_date: d.toISOString().slice(0, 10), shares, sell_to_cover_shares: 0, tax_rate_pct: 0 });
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
