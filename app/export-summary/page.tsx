"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import {
  defaultSaleTaxRate,
  eventNetReleaseShares,
  eventWithholdingShares,
  parseISO,
  totalGrantedShares,
  totalSoldShares,
  unvestedSharesAt,
  vestedSharesAt,
} from "@/lib/models";
import { formatMoney, formatNumber } from "@/lib/utils";

const SELECTION_KEY = "investor:exportSelection";

type Selection = {
  stockIds: string[];
  propertyIds: string[];
};

function readSelection(): Selection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Selection;
    if (!Array.isArray(parsed.stockIds) || !Array.isArray(parsed.propertyIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function ExportSummaryPage() {
  const { data, loading } = useData();
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    const s = readSelection();
    setSelection(
      // Fall back to "everything" if no selection has been recorded (e.g.
      // user navigated here directly).
      s ?? {
        stockIds: data.stocks.map((h) => h.id),
        propertyIds: data.properties.map((p) => p.id),
      },
    );
  }, [data.stocks, data.properties]);

  const stocks = useMemo(
    () => data.stocks.filter((h) => selection?.stockIds.includes(h.id)),
    [data.stocks, selection],
  );
  const properties = useMemo(
    () => data.properties.filter((p) => selection?.propertyIds.includes(p.id)),
    [data.properties, selection],
  );

  const today = new Date();
  const generatedAt = today.toLocaleString();

  if (loading || !selection) {
    return <div className="p-6 text-sm">Loading…</div>;
  }

  return (
    <div className="export-summary mx-auto max-w-4xl space-y-6 p-4 text-sm">
      {/* Toolbar — hidden on print. */}
      <div className="no-print flex items-center justify-between gap-2 border-b pb-3">
        <Link href="/settings" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to Settings
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-3 w-3" /> Print / Save as PDF
        </Button>
      </div>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Tax summary</h1>
        <p className="text-xs text-muted-foreground">
          Factual snapshot for your tax advisor. No modelling, scenarios, or
          projections included. Generated {generatedAt}.
        </p>
      </header>

      {stocks.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b pb-1">Stocks &amp; equity</h2>
          {stocks.map((h) => (
            <StockBlock key={h.id} h={h} today={today} />
          ))}
        </section>
      ) : null}

      {properties.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold border-b pb-1">Properties</h2>
          {properties.map((p) => (
            <PropertyBlock key={p.id} p={p} />
          ))}
        </section>
      ) : null}

      {stocks.length === 0 && properties.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No items selected. Return to Settings to choose what to include.
        </p>
      ) : null}
    </div>
  );
}

function StockBlock({ h, today }: { h: ReturnType<typeof useData>["data"]["stocks"][number]; today: Date }) {
  const vested = vestedSharesAt(h, today);
  const granted = totalGrantedShares(h);
  const unvested = unvestedSharesAt(h, today);
  const sold = totalSoldShares(h, today);

  const sortedReleases = [...(h.sales ?? [])].sort((a, b) =>
    a.release_date.localeCompare(b.release_date),
  );

  const sales = sortedReleases.filter((s) => !!s.sell_date);

  return (
    <article className="space-y-3 break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
        <h3 className="text-base font-semibold">
          {h.ticker || h.company_name || "—"}
          {h.company_name && h.ticker ? <span className="ml-2 font-normal text-muted-foreground">{h.company_name}</span> : null}
        </h3>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {h.equity_type} · {h.currency} · {h.jurisdiction}
        </span>
      </div>

      <table className="w-full text-xs tabular-nums">
        <tbody>
          <Row label="Current share price" value={formatMoney(h.current_share_price, h.currency, { fractionDigits: 2 })} />
          {h.equity_type === "Stock Options" ? (
            <Row label="Strike (grant) price" value={formatMoney(h.strike_price, h.currency, { fractionDigits: 2 })} />
          ) : null}
          <Row label="Total granted (lifetime)" value={`${formatNumber(granted)} sh`} />
          <Row label="Currently held" value={`${formatNumber(vested)} sh`} />
          <Row label="Still to vest" value={`${formatNumber(unvested)} sh`} />
          <Row label="Sold to date" value={`${formatNumber(sold)} sh`} />
          {h.notes ? <Row label="Notes" value={h.notes} /> : null}
        </tbody>
      </table>

      {h.tranches.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Vesting by tranche
          </p>
          {[...h.tranches]
            // Stable order: by grant date when present, else by first vest date.
            .sort((a, b) => {
              const ag = a.grant_date ?? a.vest_events[0]?.vest_date ?? "";
              const bg = b.grant_date ?? b.vest_events[0]?.vest_date ?? "";
              return ag.localeCompare(bg);
            })
            .map((t, idx) => (
              <TrancheBlock key={t.id ?? idx} t={t} today={today} />
            ))}
        </div>
      ) : null}

      {sortedReleases.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Release events
          </p>
          <table className="w-full text-xs tabular-nums border-collapse">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1 text-left font-normal">Release date</th>
                <th className="px-2 py-1 text-right font-normal">Shares</th>
                <th className="px-2 py-1 text-right font-normal">Release price</th>
                <th className="px-2 py-1 text-right font-normal">Withheld</th>
                <th className="px-2 py-1 text-right font-normal">Net kept</th>
              </tr>
            </thead>
            <tbody>
              {sortedReleases.map((s) => {
                const cover = eventWithholdingShares(s);
                const kept = eventNetReleaseShares(s);
                return (
                  <tr key={s.id} className="border-b">
                    <td className="px-2 py-1">{s.release_date}</td>
                    <td className="px-2 py-1 text-right">{formatNumber(s.shares)}</td>
                    <td className="px-2 py-1 text-right">
                      {s.release_price > 0 ? formatMoney(s.release_price, h.currency, { fractionDigits: 2 }) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">{formatNumber(Math.round(cover))}</td>
                    <td className="px-2 py-1 text-right">{formatNumber(Math.round(kept))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {sales.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Sale events
          </p>
          <table className="w-full text-xs tabular-nums border-collapse">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1 text-left font-normal">Sell date</th>
                <th className="px-2 py-1 text-right font-normal">Shares sold</th>
                <th className="px-2 py-1 text-right font-normal">Sale price</th>
                <th className="px-2 py-1 text-right font-normal">Release price (basis)</th>
                <th className="px-2 py-1 text-right font-normal">Tax rate</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const kept = eventNetReleaseShares(s);
                const salePrice = s.sale_price ?? h.current_share_price;
                const taxRate = s.sale_tax_rate_pct || defaultSaleTaxRate(h.jurisdiction);
                return (
                  <tr key={s.id} className="border-b">
                    <td className="px-2 py-1">{s.sell_date}</td>
                    <td className="px-2 py-1 text-right">{formatNumber(Math.round(kept))}</td>
                    <td className="px-2 py-1 text-right">{formatMoney(salePrice, h.currency, { fractionDigits: 2 })}</td>
                    <td className="px-2 py-1 text-right">
                      {s.release_price > 0 ? formatMoney(s.release_price, h.currency, { fractionDigits: 2 }) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">{taxRate.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  );
}

function TrancheBlock({
  t,
  today,
}: {
  t: ReturnType<typeof useData>["data"]["stocks"][number]["tranches"][number];
  today: Date;
}) {
  const events = [...t.vest_events].sort((a, b) => a.vest_date.localeCompare(b.vest_date));
  const total = events.reduce((s, e) => s + e.shares, 0);
  const vested = events
    .filter((e) => {
      const d = parseISO(e.vest_date);
      return d && d <= today;
    })
    .reduce((s, e) => s + e.shares, 0);
  const upcoming = total - vested;
  const first = events[0]?.vest_date ?? "";
  const last = events[events.length - 1]?.vest_date ?? "";

  return (
    <div className="space-y-2 pl-2 border-l-2 border-muted break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{t.name || "Grant"}</h4>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t.grant_date ? `Granted ${t.grant_date}` : "Grant date unrecorded"}
        </span>
      </div>

      {events.length > 0 ? (
        <>
          <table className="w-full text-xs tabular-nums">
            <tbody>
              <Row label="Total shares" value={`${formatNumber(total)} sh`} />
              <Row label="Vests" value={`${events.length} event${events.length === 1 ? "" : "s"} · ${first} → ${last}`} />
              <Row label="Vested to date" value={`${formatNumber(vested)} sh`} />
              <Row label="Still to vest" value={`${formatNumber(upcoming)} sh`} />
              {t.notes ? <Row label="Notes" value={t.notes} /> : null}
            </tbody>
          </table>

          <CumulativeVestingChart
            events={events.map(({ vest_date, shares }) => ({ vest_date, shares }))}
            today={today}
          />

          <table className="w-full text-xs tabular-nums border-collapse">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1 text-left font-normal">Date</th>
                <th className="px-2 py-1 text-right font-normal">Shares</th>
                <th className="px-2 py-1 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => {
                const d = parseISO(ev.vest_date);
                const passed = !!d && d <= today;
                return (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1">{ev.vest_date}</td>
                    <td className="px-2 py-1 text-right">{formatNumber(ev.shares)}</td>
                    <td className="px-2 py-1 text-right text-muted-foreground">
                      {passed ? "Vested" : "Upcoming"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <p className="text-xs text-muted-foreground italic">No vest events recorded.</p>
      )}
    </div>
  );
}

function PropertyBlock({ p }: { p: ReturnType<typeof useData>["data"]["properties"][number] }) {
  const equity = p.current_value - p.mortgage_balance;
  return (
    <article className="space-y-2 break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1">
        <h3 className="text-base font-semibold">{p.name || "—"}</h3>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {p.country} · {p.currency} · {p.jurisdiction}
        </span>
      </div>
      <table className="w-full text-xs tabular-nums">
        <tbody>
          {p.address ? <Row label="Address" value={p.address} /> : null}
          {p.suburb || p.region || p.postcode ? (
            <Row label="Locality" value={[p.suburb, p.region, p.postcode].filter(Boolean).join(", ")} />
          ) : null}
          {p.purchase_date ? <Row label="Purchase date" value={p.purchase_date} /> : null}
          {p.purchase_price > 0 ? <Row label="Purchase price" value={formatMoney(p.purchase_price, p.currency)} /> : null}
          <Row label="Current value" value={formatMoney(p.current_value, p.currency)} />
          <Row label="Mortgage balance" value={formatMoney(p.mortgage_balance, p.currency)} />
          <Row label="Equity" value={formatMoney(equity, p.currency)} />
          {p.notes ? <Row label="Notes" value={p.notes} /> : null}
        </tbody>
      </table>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-2 py-1 text-muted-foreground w-1/3">{label}</td>
      <td className="px-2 py-1">{value}</td>
    </tr>
  );
}

/** Step chart of cumulative tranche shares from the first vest_date to the
 *  last, with a dashed marker at today. Inline SVG so the print/PDF view
 *  doesn't need to pull in a chart library on this route. */
function CumulativeVestingChart({
  events,
  today,
}: {
  events: { vest_date: string; shares: number }[];
  today: Date;
}) {
  const sorted = [...events].sort((a, b) => a.vest_date.localeCompare(b.vest_date));
  const total = sorted.reduce((s, e) => s + e.shares, 0);
  if (sorted.length === 0 || total <= 0) return null;

  const start = parseISO(sorted[0].vest_date);
  const end = parseISO(sorted[sorted.length - 1].vest_date);
  if (!start || !end) return null;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const range = endMs - startMs || 1;

  const W = 640;
  const H = 110;
  const padL = 44;
  const padR = 12;
  const padT = 8;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const xFor = (ms: number) => padL + (innerW * (ms - startMs)) / range;
  const yFor = (n: number) => padT + innerH - (innerH * n) / total;

  // Step-after path: jump up at each event date.
  let cum = 0;
  const segments: string[] = [`M ${xFor(startMs)},${yFor(0)}`];
  for (const ev of sorted) {
    const d = parseISO(ev.vest_date);
    if (!d) continue;
    const x = xFor(d.getTime());
    segments.push(`L ${x},${yFor(cum)}`);
    cum += ev.shares;
    segments.push(`L ${x},${yFor(cum)}`);
  }
  // Trail out to the right edge so the curve ends at the total.
  segments.push(`L ${xFor(endMs)},${yFor(cum)}`);
  const path = segments.join(" ");

  const todayMs = today.getTime();
  const todayInside = todayMs >= startMs && todayMs <= endMs;
  const todayX = todayInside ? xFor(todayMs) : null;

  // Year ticks on the x-axis.
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const yearTicks: number[] = [];
  for (let y = startYear; y <= endYear; y++) yearTicks.push(Date.UTC(y, 0, 1));

  const halfTotal = Math.round(total / 2);

  return (
    <div className="space-y-0.5 break-inside-avoid">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Cumulative shares vesting · {sorted[0].vest_date} → {sorted[sorted.length - 1].vest_date} · {formatNumber(total)} total
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" role="img" aria-label="Cumulative vesting curve">
        {/* Axes */}
        <line x1={padL} y1={padT + innerH} x2={W - padR} y2={padT + innerH} stroke="#888" strokeWidth="0.5" />
        <line x1={padL} y1={padT} x2={padL} y2={padT + innerH} stroke="#888" strokeWidth="0.5" />
        {/* Year ticks */}
        {yearTicks.map((ms) => {
          const x = xFor(ms);
          if (x < padL || x > W - padR) return null;
          return (
            <g key={ms}>
              <line x1={x} y1={padT + innerH} x2={x} y2={padT + innerH + 3} stroke="#888" strokeWidth="0.5" />
              <text x={x} y={H - 6} fontSize="9" textAnchor="middle" fill="#666">
                {new Date(ms).getUTCFullYear()}
              </text>
            </g>
          );
        })}
        {/* Y labels: 0, half, total */}
        <text x={padL - 4} y={padT + innerH} fontSize="9" textAnchor="end" fill="#666" dominantBaseline="middle">0</text>
        <text x={padL - 4} y={yFor(halfTotal)} fontSize="9" textAnchor="end" fill="#666" dominantBaseline="middle">{formatNumber(halfTotal)}</text>
        <text x={padL - 4} y={padT} fontSize="9" textAnchor="end" fill="#666" dominantBaseline="middle">{formatNumber(total)}</text>
        {/* Today line */}
        {todayX !== null ? (
          <g>
            <line x1={todayX} y1={padT} x2={todayX} y2={padT + innerH} stroke="#000" strokeWidth="0.6" strokeDasharray="3,2" />
            <text x={todayX} y={padT - 1} fontSize="8" textAnchor="middle" fill="#000">today</text>
          </g>
        ) : null}
        {/* Step path */}
        <path d={path} stroke="#0f172a" fill="none" strokeWidth="1.4" strokeLinejoin="miter" strokeLinecap="butt" />
      </svg>
    </div>
  );
}
