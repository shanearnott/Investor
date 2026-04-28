"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Settings, SettingsSchema, SUPPORTED_CURRENCIES, SUPPORTED_JURISDICTIONS } from "@/lib/models";
import { DEFAULTS as TAX_DEFAULTS, getRules } from "@/lib/tax";

const OVERRIDE_FIELDS: { key: keyof typeof TAX_DEFAULTS["California"]; label: string; kind: "number" | "bool" }[] = [
  { key: "ordinary_income_rate", label: "Ordinary income rate (0..1)", kind: "number" },
  { key: "short_term_cap_gains_rate", label: "Short-term capital gains rate", kind: "number" },
  { key: "long_term_cap_gains_rate", label: "Long-term capital gains rate", kind: "number" },
  { key: "long_term_threshold_years", label: "Long-term threshold (years)", kind: "number" },
  { key: "cgt_discount_pct", label: "CGT discount % (e.g. 50 for AUS)", kind: "number" },
  { key: "property_cgt_rate", label: "Property CGT rate", kind: "number" },
  { key: "property_cgt_discount_pct", label: "Property CGT discount %", kind: "number" },
  { key: "rsu_vest_taxed_as_income", label: "RSU vest taxed as income", kind: "bool" },
  { key: "primary_residence_exempt", label: "Primary residence exempt", kind: "bool" },
];

export default function SettingsPage() {
  const { data, setSettings, isDemo, loadDemo, resetLocal } = useData();
  const [s, setS] = useState<Settings>(data.settings);
  const [jurisToEdit, setJurisToEdit] = useState<string>("California");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  const setFx = (ccy: string, rate: number) =>
    setS((p) => ({ ...p, fx_rates: { ...p.fx_rates, [ccy]: rate } }));

  const removeFx = (ccy: string) =>
    setS((p) => {
      const next = { ...p.fx_rates };
      delete next[ccy];
      return { ...p, fx_rates: next };
    });

  const rules = getRules(jurisToEdit, s);
  const ov = (s.tax_overrides[jurisToEdit] as Record<string, number | boolean>) ?? {};
  const setOv = (key: string, val: number | boolean | undefined) =>
    setS((p) => {
      const next = { ...(p.tax_overrides[jurisToEdit] ?? {}) } as Record<string, number | boolean>;
      if (val === undefined) {
        delete next[key];
      } else {
        next[key] = val;
      }
      const allOv = { ...p.tax_overrides };
      if (Object.keys(next).length === 0) delete allOv[jurisToEdit];
      else allOv[jurisToEdit] = next;
      return { ...p, tax_overrides: allOv };
    });

  const save = async () => {
    setError(null);
    setSavedNote(null);
    const parsed = SettingsSchema.safeParse(s);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    await setSettings(parsed.data);
    setSavedNote("Saved.");
    setTimeout(() => setSavedNote(null), 2000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Currency</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Primary">
            <Select value={s.primary_currency} onChange={(e) => update("primary_currency", e.target.value as Settings["primary_currency"])}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Secondary">
            <Select value={s.secondary_currency} onChange={(e) => update("secondary_currency", e.target.value as Settings["secondary_currency"])}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Default jurisdiction">
            <Select value={s.default_jurisdiction} onChange={(e) => update("default_jurisdiction", e.target.value as Settings["default_jurisdiction"])}>
              {SUPPORTED_JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>FX rates</CardTitle>
          <CardDescription>1 USD = X currency. Edit in place.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.entries(s.fx_rates).map(([ccy, rate]) => (
            <div key={ccy} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input value={ccy} disabled />
              <Input
                type="number"
                step="0.0001"
                value={rate}
                onChange={(e) => setFx(ccy, Number(e.target.value))}
              />
              <Button size="icon" variant="ghost" onClick={() => removeFx(ccy)} disabled={ccy === "USD"}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <AddFxRow existing={Object.keys(s.fx_rates)} onAdd={(ccy, rate) => setFx(ccy, rate)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax overrides</CardTitle>
          <CardDescription>
            Defaults are top-marginal estimates per jurisdiction. Override per field; clear to reset.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Jurisdiction">
            <Select value={jurisToEdit} onChange={(e) => setJurisToEdit(e.target.value)}>
              {SUPPORTED_JURISDICTIONS.map((j) => <option key={j}>{j}</option>)}
            </Select>
          </Field>
          <p className="text-xs text-muted-foreground">
            {TAX_DEFAULTS[jurisToEdit]?.notes ?? ""}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {OVERRIDE_FIELDS.map(({ key, label, kind }) => {
              const baseVal = rules[key];
              const curVal = ov[key as string] ?? baseVal;
              if (kind === "bool") {
                return (
                  <label key={key} className="flex items-center gap-2 rounded-md border px-3 py-2">
                    <input
                      type="checkbox"
                      checked={Boolean(curVal)}
                      onChange={(e) => {
                        if (e.target.checked === Boolean(baseVal)) setOv(key as string, undefined);
                        else setOv(key as string, e.target.checked);
                      }}
                    />
                    <span className="text-sm">{label}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">default {String(baseVal)}</span>
                  </label>
                );
              }
              return (
                <Field key={key} label={label} hint={`default ${baseVal}`}>
                  <Input
                    type="number"
                    step="0.0001"
                    value={Number(curVal)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Math.abs(v - Number(baseVal)) < 1e-9) setOv(key as string, undefined);
                      else setOv(key as string, v);
                    }}
                  />
                </Field>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo & data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadDemo}>Load demo data</Button>
          <Button variant="ghost" onClick={resetLocal}>Clear local (demo) data</Button>
          {isDemo ? (
            <span className="text-xs text-muted-foreground self-center">
              Currently in demo mode (data in browser localStorage).
            </span>
          ) : (
            <span className="text-xs text-muted-foreground self-center">
              Signed in: data is saved to your Drive.
            </span>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        {savedNote ? <span className="text-sm text-emerald-700 self-center">{savedNote}</span> : null}
        {error ? <span className="text-sm text-destructive self-center">{error}</span> : null}
        <Button onClick={save}>Save settings</Button>
      </div>
    </div>
  );
}

function AddFxRow({ existing, onAdd }: { existing: string[]; onAdd: (ccy: string, rate: number) => void }) {
  const [ccy, setCcy] = useState<string>("");
  const [rate, setRate] = useState<number>(1);
  const options = SUPPORTED_CURRENCIES.filter((c) => !existing.includes(c));
  if (options.length === 0) return null;
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 pt-2 border-t">
      <Select value={ccy} onChange={(e) => setCcy(e.target.value)}>
        <option value="">(add currency)</option>
        {options.map((c) => <option key={c}>{c}</option>)}
      </Select>
      <Input type="number" step="0.0001" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
      <Button
        size="sm"
        onClick={() => {
          if (ccy) {
            onAdd(ccy, rate);
            setCcy("");
            setRate(1);
          }
        }}
      >
        <Plus className="h-3 w-3" /> Add
      </Button>
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
