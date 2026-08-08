"use client";

import { useEffect, useRef, useState } from "react";
import { Cloud, CloudOff, Download, FileDown, FileUp, Plus, Trash2, Upload } from "lucide-react";

import { useData, type AutoSyncStatus } from "@/components/data-provider";
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
  const hasUserData =
    data.stocks.length > 0 ||
    data.properties.length > 0 ||
    data.scenarios.length > 0 ||
    data.projects.length > 0;
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
          <CardTitle>{hasUserData ? "Data" : "Demo & data"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasUserData ? (
            <p className="text-xs text-muted-foreground">
              Local data lives in your browser&apos;s localStorage. Use Google Drive below or the file backup card to back up or sync across devices.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={loadDemo}>Load demo data</Button>
              <Button variant="ghost" onClick={resetLocal}>Clear local (demo) data</Button>
              <span className="text-xs text-muted-foreground self-center">
                Local data lives in your browser&apos;s localStorage. Use Google Drive below to back up or sync across devices.
              </span>
            </div>
          )}

          <DriveSyncSection settings={s} update={update} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup & restore</CardTitle>
          <CardDescription>
            Save a JSON snapshot of all your data to your computer, or restore from one if your local data gets corrupted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FileBackupSection />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax summary export</CardTitle>
          <CardDescription>
            Generate a factual PDF (via the print dialog) of your selected
            stocks and properties to share with a tax advisor. Modelling
            assumptions and scenarios are not included — just the facts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TaxSummaryExportSection />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build info</CardTitle>
          <CardDescription>
            Use this to confirm whether the page you&apos;re looking at
            matches the latest deploy. If the build id doesn&apos;t
            match what&apos;s on GitHub&apos;s main branch, hard-refresh
            to bust the PWA cache.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BuildInfoSection />
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
    revolvers: unknown[];
    settings: Settings;
  };
};

const LAST_SYNC_KEY = "investor:driveLastSync";

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
    setRevolvers,
    setSettings,
    driveToken: token,
    driveEmail: email,
    setDriveAuth,
    clearDriveAuth,
    autoSync,
  } = useData();

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Restore last-sync timestamp from localStorage; token + email come from
  // the shared DataProvider context (already hydrated from sessionStorage).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ls = localStorage.getItem(LAST_SYNC_KEY);
    if (ls) setLastSync(ls);
  }, []);

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
      // Persist the Client ID to settings before connecting so a reload
      // doesn't lose the value the user just typed in.
      if (data.settings.google_oauth_client_id !== clientId) {
        await setSettings({ ...data.settings, google_oauth_client_id: clientId });
      }
      const t = await requestAccessToken(clientId);
      const e = await getAuthorisedEmail(t);
      setDriveAuth(t, e);
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
    clearDriveAuth();
    setNote("Disconnected.");
  };

  // If a Drive call fails with 401, the access token expired (they're 1h);
  // wipe the session so the user re-authenticates instead of seeing a confusing
  // server error.
  const handleAuthError = (e: unknown): boolean => {
    const msg = (e as Error).message ?? "";
    if (msg.includes(" 401") || msg.includes("Invalid Credentials")) {
      clearDriveAuth();
      setErr("Session expired — click Connect Drive again.");
      return true;
    }
    return false;
  };

  const handleSyncToDrive = async () => {
    setErr(null); setNote(null);
    if (!token) { setErr("Connect to Drive first."); return; }
    const lastSyncDesc = lastSync ? ` (replacing the copy from ${new Date(lastSync).toLocaleString()})` : "";
    const ok = typeof window === "undefined" ? true : window.confirm(
      `Upload current local data to Drive${lastSyncDesc}? The existing ${DRIVE_FILE_NAME} in your Drive will be overwritten.`,
    );
    if (!ok) return;
    setBusy("up");
    try {
      const exported_at = new Date().toISOString();
      const bundle: DriveBundle = {
        version: 1,
        exported_at,
        collections: {
          stocks: data.stocks,
          properties: data.properties,
          scenarios: data.scenarios,
          projects: data.projects,
          revolvers: data.revolvers,
          settings: data.settings,
        },
      };
      await writeToDrive(token, bundle);
      if (typeof window !== "undefined") {
        localStorage.setItem(LAST_SYNC_KEY, exported_at);
      }
      setLastSync(exported_at);
      setNote(`Saved to Drive · ${DRIVE_FILE_NAME}`);
    } catch (e) {
      if (!handleAuthError(e)) setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleRestoreFromDrive = async () => {
    setErr(null); setNote(null);
    if (!token) { setErr("Connect to Drive first."); return; }
    const ok = typeof window === "undefined" ? true : window.confirm(
      `Restore from Drive? This will REPLACE all local stocks, properties, scenarios, projects, revolver scenarios, and settings with whatever is in ${DRIVE_FILE_NAME}. The current local data cannot be recovered after this unless you've downloaded a file backup.`,
    );
    if (!ok) return;
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
        setRevolvers(parsed.collections.revolvers ?? []),
        setSettings(parsed.collections.settings ?? data.settings),
      ]);
      setNote("Restored from Drive.");
    } catch (e) {
      if (!handleAuthError(e)) setErr((e as Error).message);
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

      <Field label="Google OAuth Client ID" hint="Create one in Google Cloud Console (Web application). Add this site's URL as a JavaScript origin. Saved automatically when you click Connect Drive.">
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
      {token ? (
        <p className="text-[11px] text-muted-foreground">
          Auto-sync: {autoSyncLabel(autoSync)}
          {lastSync ? ` · Last synced ${new Date(lastSync).toLocaleString()}` : null}
        </p>
      ) : lastSync ? (
        <p className="text-[11px] text-muted-foreground">
          Last synced: {new Date(lastSync).toLocaleString()}
        </p>
      ) : null}

      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">How to get a Client ID</summary>
        <ol className="list-decimal pl-4 space-y-1 pt-1">
          <li>Open <a className="underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console → Credentials</a> in a new tab.</li>
          <li>Create credentials → OAuth client ID → <b>Web application</b>.</li>
          <li>
            Under <b>Authorised JavaScript origins</b>, add{" "}
            <code>https://shanearnott.github.io</code> (no path, no trailing slash) for the live site.
            Only add <code>http://localhost:3000</code> if you also run <code>npm run dev</code> locally.
            No redirect URI is needed for popup auth.
          </li>
          <li>OAuth consent screen → add scope <code>.../auth/drive.file</code> and add yourself as a test user (or publish).</li>
          <li>Copy the Client ID, paste it above, then click <b>Connect Drive</b> — the ID is saved automatically.</li>
        </ol>
      </details>
    </div>
  );
}

function autoSyncLabel(s: AutoSyncStatus): string {
  switch (s.kind) {
    case "idle": return "on (idle)";
    case "pending": return "saving in a moment…";
    case "pushing": return "uploading…";
    case "pulling": return "checking Drive…";
    case "ok": return s.direction === "push" ? "uploaded just now" : "pulled latest from Drive";
    case "error": return `error — ${s.msg}`;
  }
}

function parseDriveBundle(raw: unknown): DriveBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { version?: number; collections?: unknown };
  if (r.version !== 1 || !r.collections || typeof r.collections !== "object") return null;
  return r as DriveBundle;
}

function backupFileName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `investor-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
}

function FileBackupSection() {
  const {
    data,
    setStocks,
    setProperties,
    setScenarios,
    setProjects,
    setRevolvers,
    setSettings,
  } = useData();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<"download" | "restore" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleDownload = () => {
    setErr(null); setNote(null);
    setBusy("download");
    try {
      const bundle: DriveBundle = {
        version: 1,
        exported_at: new Date().toISOString(),
        collections: {
          stocks: data.stocks,
          properties: data.properties,
          scenarios: data.scenarios,
          projects: data.projects,
          revolvers: data.revolvers,
          settings: data.settings,
        },
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFileName();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNote("Backup downloaded.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleRestoreClick = () => {
    setErr(null); setNote(null);
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ok = window.confirm(
      `Restore from "${file.name}"? This will replace all current stocks, properties, scenarios, projects, revolver scenarios, and settings.`,
    );
    if (!ok) return;
    setBusy("restore");
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const parsed = parseDriveBundle(raw);
      if (!parsed) {
        setErr("That file doesn't look like an Investor backup (missing version or collections).");
        return;
      }
      await Promise.all([
        setStocks(parsed.collections.stocks ?? []),
        setProperties(parsed.collections.properties ?? []),
        setScenarios(parsed.collections.scenarios ?? []),
        setProjects(parsed.collections.projects ?? []),
        setRevolvers(parsed.collections.revolvers ?? []),
        setSettings(parsed.collections.settings ?? data.settings),
      ]);
      setNote(`Restored from ${file.name}.`);
    } catch (ex) {
      setErr((ex as Error).message || "Could not read file.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={handleDownload} disabled={!!busy}>
          <FileDown className="h-3 w-3" /> {busy === "download" ? "Saving…" : "Download backup file"}
        </Button>
        <Button size="sm" variant="outline" onClick={handleRestoreClick} disabled={!!busy}>
          <FileUp className="h-3 w-3" /> {busy === "restore" ? "Restoring…" : "Restore from file"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChosen}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Same format as Drive sync. Restore replaces all existing data after confirmation.
      </p>
      {note ? <p className="text-xs text-emerald-700">{note}</p> : null}
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
    </div>
  );
}

const TAX_EXPORT_SELECTION_KEY = "investor:exportSelection";

function TaxSummaryExportSection() {
  const { data } = useData();
  const [stockIds, setStockIds] = useState<Set<string>>(() => new Set(data.stocks.map((h) => h.id)));
  const [propertyIds, setPropertyIds] = useState<Set<string>>(() => new Set(data.properties.map((p) => p.id)));

  // Keep selection in sync if the underlying data changes (e.g. after a
  // Drive restore). Add any new items to the selection; remove deleted ones.
  useEffect(() => {
    setStockIds((prev) => new Set(data.stocks.map((h) => h.id).filter((id) => prev.has(id) || !prev.size ? true : prev.has(id))));
    setPropertyIds((prev) => new Set(data.properties.map((p) => p.id).filter((id) => prev.has(id) || !prev.size ? true : prev.has(id))));
  }, [data.stocks, data.properties]);

  const toggleStock = (id: string) =>
    setStockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleProperty = (id: string) =>
    setPropertyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllStocks = (on: boolean) =>
    setStockIds(on ? new Set(data.stocks.map((h) => h.id)) : new Set());
  const selectAllProperties = (on: boolean) =>
    setPropertyIds(on ? new Set(data.properties.map((p) => p.id)) : new Set());

  const open = () => {
    if (typeof window === "undefined") return;
    const payload = JSON.stringify({
      stockIds: Array.from(stockIds),
      propertyIds: Array.from(propertyIds),
    });
    // localStorage (not sessionStorage): each tab has its own
    // sessionStorage, and we open the export page with noopener so the
    // new tab can't read the opener's session.
    window.localStorage.setItem(TAX_EXPORT_SELECTION_KEY, payload);
    // basePath comes from next.config (exposed via env.NEXT_PUBLIC_BASE_PATH);
    // trailing slash matches the trailingSlash: true config so GH Pages
    // resolves the page instead of 404ing.
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    window.open(`${basePath}/export-summary/`, "_blank", "noopener,noreferrer");
  };

  const totalStocks = data.stocks.length;
  const totalProperties = data.properties.length;
  const nothingSelected = stockIds.size === 0 && propertyIds.size === 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">Stocks &amp; equity ({stockIds.size}/{totalStocks})</p>
          {totalStocks > 0 ? (
            <div className="flex gap-2 text-[11px]">
              <button type="button" className="underline text-muted-foreground hover:text-foreground" onClick={() => selectAllStocks(true)}>All</button>
              <button type="button" className="underline text-muted-foreground hover:text-foreground" onClick={() => selectAllStocks(false)}>None</button>
            </div>
          ) : null}
        </div>
        {totalStocks === 0 ? (
          <p className="text-xs text-muted-foreground italic">No stocks yet.</p>
        ) : (
          <ul className="space-y-1">
            {data.stocks.map((h) => (
              <li key={h.id}>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stockIds.has(h.id)}
                    onChange={() => toggleStock(h.id)}
                  />
                  <span>{h.ticker || h.company_name || "—"}</span>
                  <span className="text-muted-foreground">· {h.equity_type}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">Properties ({propertyIds.size}/{totalProperties})</p>
          {totalProperties > 0 ? (
            <div className="flex gap-2 text-[11px]">
              <button type="button" className="underline text-muted-foreground hover:text-foreground" onClick={() => selectAllProperties(true)}>All</button>
              <button type="button" className="underline text-muted-foreground hover:text-foreground" onClick={() => selectAllProperties(false)}>None</button>
            </div>
          ) : null}
        </div>
        {totalProperties === 0 ? (
          <p className="text-xs text-muted-foreground italic">No properties yet.</p>
        ) : (
          <ul className="space-y-1">
            {data.properties.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={propertyIds.has(p.id)}
                    onChange={() => toggleProperty(p.id)}
                  />
                  <span>{p.name || "—"}</span>
                  {p.country ? <span className="text-muted-foreground">· {p.country}</span> : null}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={open} disabled={nothingSelected}>
          Open export view
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Opens in a new tab. Use your browser&apos;s print dialog (Cmd/Ctrl-P) and choose <b>Save as PDF</b>.
      </p>
    </div>
  );
}

function BuildInfoSection() {
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
  const buildTimeRaw = process.env.NEXT_PUBLIC_BUILD_TIME;
  const buildTime = buildTimeRaw
    ? new Date(buildTimeRaw).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "unknown";
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <span className="text-xs text-muted-foreground">Build id</span>
        <code className="text-xs font-medium tabular-nums">{buildId}</code>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <span className="text-xs text-muted-foreground">Built at</span>
        <span className="text-xs tabular-nums">{buildTime}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        On GitHub Actions builds, the build id is the first 7 chars of the
        commit sha. Local builds are stamped <code>local-&lt;millis&gt;</code>.
      </p>
    </div>
  );
}
