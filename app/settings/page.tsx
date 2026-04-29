"use client";

import { useState } from "react";
import { Cloud, CloudOff, Download, Plus, Trash2, Upload } from "lucide-react";

import { useData } from "@/components/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import {
  type InvestmentProject,
  type Property,
  type Scenario,
  Settings,
  SettingsSchema,
  type StockHolding,
  SUPPORTED_CURRENCIES,
  SUPPORTED_JURISDICTIONS,
} from "@/lib/models";
import {
  DRIVE_FILE_NAME,
  getAuthorisedEmail,
  readFromDrive,
  requestAccessToken,
  revokeAccessToken,
  writeToDrive,
} from "@/lib/drive-client";
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
  const { data, setSettings, loadDemo, resetLocal } = useData();
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
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={loadDemo}>Load demo data</Button>
            <Button variant="ghost" onClick={resetLocal}>Clear local (demo) data</Button>
            <span className="text-xs text-muted-foreground self-center">
              Local data lives in your browser&apos;s localStorage. Use Google Drive below to back up or sync across devices.
            </span>
          </div>

          <DriveSyncSection settings={s} update={update} />
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

type DriveBundle = {
  version: 1;
  exported_at: string;
  collections: {
    stocks: StockHolding[];
    properties: Property[];
    scenarios: Scenario[];
    projects: InvestmentProject[];
    settings: Settings;
  };
};

function DriveSyncSection({
  settings,
  update,
}: {
  settings: Settings;
  update: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
}) {
  const {
    data,
    setStocks,
    setProperties,
    setScenarios,
    setProjects,
    setSettings,
  } = useData();

  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const clientId = settings.google_oauth_client_id?.trim() ?? "";
  const canConnect = clientId.length > 0;

  const handleConnect = async () => {
    setErr(null); setNote(null);
    if (!canConnect) {
      setErr("Paste your Google OAuth Client ID first.");
      return;
    }
    setBusy("connect");
    try {
      const t = await requestAccessToken(clientId);
      setToken(t);
      const e = await getAuthorisedEmail(t);
      setEmail(e);
      setNote("Connected to Drive.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    setErr(null); setNote(null);
    if (token) await revokeAccessToken(token);
    setToken(null);
    setEmail(null);
    setNote("Disconnected.");
  };

  const handleSyncToDrive = async () => {
    setErr(null); setNote(null);
    if (!token) { setErr("Connect to Drive first."); return; }
    setBusy("up");
    try {
      const bundle: DriveBundle = {
        version: 1,
        exported_at: new Date().toISOString(),
        collections: {
          stocks: data.stocks,
          properties: data.properties,
          scenarios: data.scenarios,
          projects: data.projects,
          settings: data.settings,
        },
      };
      await writeToDrive(token, bundle);
      setNote(`Saved to Drive · ${DRIVE_FILE_NAME}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleRestoreFromDrive = async () => {
    setErr(null); setNote(null);
    if (!token) { setErr("Connect to Drive first."); return; }
    setBusy("down");
    try {
      const raw = await readFromDrive(token);
      if (!raw) {
        setErr(`No ${DRIVE_FILE_NAME} found in your Drive yet. Run "Sync to Drive" first.`);
        return;
      }
      const parsed = parseDriveBundle(raw);
      if (!parsed) {
        setErr("File found but it doesn't look like an Investor backup.");
        return;
      }
      // Apply collections; persistence happens inside each setter.
      await Promise.all([
        setStocks(parsed.collections.stocks ?? []),
        setProperties(parsed.collections.properties ?? []),
        setScenarios(parsed.collections.scenarios ?? []),
        setProjects(parsed.collections.projects ?? []),
        setSettings(parsed.collections.settings ?? data.settings),
      ]);
      setNote("Restored from Drive.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border bg-secondary/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Google Drive sync</p>
          <p className="text-[11px] text-muted-foreground">
            Saves a single <code>{DRIVE_FILE_NAME}</code> to your own Drive (drive.file scope — the app can&apos;t see anything else). Optional.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${token ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
          {token ? <><Cloud className="h-3 w-3" /> Connected{email ? ` · ${email}` : ""}</> : <><CloudOff className="h-3 w-3" /> Not connected</>}
        </span>
      </div>

      <Field label="Google OAuth Client ID" hint="Create one in Google Cloud Console (Web application). Authorize this site's URL as a JavaScript origin. Save settings before connecting.">
        <Input
          value={settings.google_oauth_client_id ?? ""}
          onChange={(e) => update("google_oauth_client_id", e.target.value)}
          placeholder="123456789-abc.apps.googleusercontent.com"
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        {token ? (
          <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={!!busy}>
            <CloudOff className="h-3 w-3" /> Disconnect
          </Button>
        ) : (
          <Button size="sm" onClick={handleConnect} disabled={!canConnect || !!busy}>
            <Cloud className="h-3 w-3" /> {busy === "connect" ? "Connecting…" : "Connect Drive"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={handleSyncToDrive} disabled={!token || !!busy}>
          <Upload className="h-3 w-3" /> {busy === "up" ? "Saving…" : "Sync to Drive"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleRestoreFromDrive} disabled={!token || !!busy}>
          <Download className="h-3 w-3" /> {busy === "down" ? "Restoring…" : "Restore from Drive"}
        </Button>
      </div>

      {note ? <p className="text-xs text-emerald-700">{note}</p> : null}
      {err ? <p className="text-xs text-destructive">{err}</p> : null}

      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">How to get a Client ID</summary>
        <ol className="list-decimal pl-4 space-y-1 pt-1">
          <li>Open <a className="underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console → Credentials</a> in a new tab.</li>
          <li>Create credentials → OAuth client ID → <b>Web application</b>.</li>
          <li>Under <b>Authorised JavaScript origins</b>, add this site&apos;s base URL (e.g. https://shanearnott.github.io). No redirect URI is needed for popup auth.</li>
          <li>OAuth consent screen → add scope <code>.../auth/drive.file</code> and add yourself as a test user (or publish).</li>
          <li>Copy the Client ID and paste it above. Click Save settings, then Connect Drive.</li>
        </ol>
      </details>
    </div>
  );
}

function parseDriveBundle(raw: unknown): DriveBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { version?: number; collections?: unknown };
  if (r.version !== 1 || !r.collections || typeof r.collections !== "object") return null;
  return r as DriveBundle;
}
