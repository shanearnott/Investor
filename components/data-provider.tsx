"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { buildDemoData } from "@/lib/demo-data";
import { getAuthorisedEmail, readFromDrive, requestAccessToken, writeToDrive } from "@/lib/drive-client";
import {
  COLLECTION_FILES,
  SettingsSchema,
  newId,
  type CollectionsMap,
  type InvestmentProject,
  type Property,
  type Scenario,
  type Settings,
  migrateHoldingSales,
  migrateScenarioSales,
  dropScenarioSellStockIds,
  type StockHolding,
} from "@/lib/models";
import {
  clearLocal,
  loadCollection,
  saveCollection,
} from "@/lib/storage-client";

type DataContextValue = {
  loading: boolean;
  error: string | null;
  /** True when no Drive account is connected — data is local-only / unsynced.
   *  Header shows "Demo mode" in this state. */
  isDemo: boolean;
  data: CollectionsMap;
  setStocks: (next: StockHolding[]) => Promise<void>;
  setProperties: (next: Property[]) => Promise<void>;
  setScenarios: (next: Scenario[]) => Promise<void>;
  setProjects: (next: InvestmentProject[]) => Promise<void>;
  setRevolvers: (next: unknown[]) => Promise<void>;
  setSettings: (next: Settings) => Promise<void>;
  loadDemo: () => void;
  resetLocal: () => void;
  reload: () => Promise<void>;
  /** Currency used to render all monetary values across charts/figures. */
  displayCurrency: string;
  setDisplayCurrency: (ccy: string) => void;
  /** Google Drive auth state — null when not connected. Token lives in
   *  sessionStorage so it survives reload within a tab; email is the
   *  authorised account's address. */
  driveToken: string | null;
  driveEmail: string | null;
  setDriveAuth: (token: string, email: string | null) => void;
  clearDriveAuth: () => void;
  /** Current sync state between local data and the Drive copy. Updated
   *  by recheckSyncStatus (no data applied), by pushToDrive and
   *  pullFromDrive, and marked local_newer when the user edits anything
   *  while connected. */
  syncStatus: DriveSyncStatus;
  /** Re-fetch Drive bundle metadata and update syncStatus. Does NOT
   *  apply any data — a drive-newer bundle sits waiting for the user
   *  to explicitly pullFromDrive. */
  recheckSyncStatus: () => Promise<void>;
  /** Push the current local data to Drive. Clears local-dirty on
   *  success and sets syncStatus to in_sync. */
  pushToDrive: () => Promise<void>;
  /** Pull Drive's copy, apply it to local, clear local-dirty, set
   *  syncStatus to in_sync. Overwrites any local edits since lastSync. */
  pullFromDrive: () => Promise<void>;
};

export type DriveSyncStatus =
  | { kind: "not_connected" }
  | { kind: "checking" }
  | { kind: "in_sync"; at: string }
  | { kind: "local_newer" }
  | { kind: "drive_newer"; driveExportedAt: string }
  | { kind: "diverged"; driveExportedAt: string }
  | { kind: "drive_empty" }
  | { kind: "error"; msg: string };

/** @deprecated kept for callers that still reference the old name;
 *  identical to DriveSyncStatus. */
export type AutoSyncStatus = DriveSyncStatus;

const DISPLAY_CCY_KEY = "investor:displayCurrency";
const DRIVE_TOKEN_KEY = "investor:driveToken";
const DRIVE_EMAIL_KEY = "investor:driveEmail";
const DRIVE_REMEMBER_KEY = "investor:driveRememberEmail";
const DRIVE_LAST_SYNC_KEY = "investor:driveLastSync";
const DRIVE_LOCAL_DIRTY_KEY = "investor:driveLocalDirty";

const Ctx = createContext<DataContextValue | null>(null);

const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

const EMPTY: CollectionsMap = {
  stocks: [],
  properties: [],
  scenarios: [],
  projects: [],
  revolvers: [],
  settings: DEFAULT_SETTINGS,
};

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<CollectionsMap>(EMPTY);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [displayCurrency, setDisplayCurrencyState] = useState<string>(
    DEFAULT_SETTINGS.primary_currency,
  );
  const [driveToken, setDriveTokenState] = useState<string | null>(null);
  const [driveEmail, setDriveEmailState] = useState<string | null>(null);

  // Hydrate persisted display-currency choice + Drive auth (sessionStorage so
  // a reload within the tab stays connected, but a new tab/browser starts
  // fresh).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(DISPLAY_CCY_KEY);
    if (v) setDisplayCurrencyState(v);
    const t = window.sessionStorage.getItem(DRIVE_TOKEN_KEY);
    const e = window.sessionStorage.getItem(DRIVE_EMAIL_KEY);
    if (t) setDriveTokenState(t);
    if (e) setDriveEmailState(e);
  }, []);

  const setDisplayCurrency = useCallback((ccy: string) => {
    setDisplayCurrencyState(ccy);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISPLAY_CCY_KEY, ccy);
    }
  }, []);

  const setDriveAuth = useCallback((token: string, email: string | null) => {
    setDriveTokenState(token);
    setDriveEmailState(email);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(DRIVE_TOKEN_KEY, token);
      if (email) {
        window.sessionStorage.setItem(DRIVE_EMAIL_KEY, email);
        // Persist the Drive identity so subsequent loads can attempt a
        // silent reconnect without a popup. Cleared by clearDriveAuth.
        window.localStorage.setItem(DRIVE_REMEMBER_KEY, email);
      } else {
        window.sessionStorage.removeItem(DRIVE_EMAIL_KEY);
      }
    }
  }, []);

  const clearDriveAuth = useCallback(() => {
    setDriveTokenState(null);
    setDriveEmailState(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(DRIVE_TOKEN_KEY);
      window.sessionStorage.removeItem(DRIVE_EMAIL_KEY);
      window.localStorage.removeItem(DRIVE_REMEMBER_KEY);
    }
  }, []);

  const inflightLoad = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++inflightLoad.current;
    setLoading(true);
    setError(null);
    try {
      const [stocksRaw, properties, scenariosRaw, projects, revolvers, settings] = await Promise.all([
        loadCollection("stocks", [] as StockHolding[]),
        loadCollection("properties", [] as Property[]),
        loadCollection("scenarios", [] as Scenario[]),
        loadCollection("projects", [] as InvestmentProject[]),
        loadCollection("revolvers", [] as unknown[]),
        loadCollection("settings", DEFAULT_SETTINGS as Settings),
      ]);
      if (ticket !== inflightLoad.current) return;

      // One-time migration: existing demo scenarios shipped with horizon_years=10
      // before the default was changed to 5. Clamp anything > 5 down to 5 so
      // the user sees the new default they explicitly asked for. Marked with a
      // version flag so it doesn't repeat on subsequent loads.
      const MIG_KEY = "investor:migration:v1";
      let scenarios = scenariosRaw ?? [];
      if (typeof window !== "undefined" && !window.localStorage.getItem(MIG_KEY)) {
        const before = JSON.stringify(scenarios);
        scenarios = scenarios.map((s) => (s.horizon_years > 5 ? { ...s, horizon_years: 5 } : s));
        if (JSON.stringify(scenarios) !== before) {
          await saveCollection("scenarios", scenarios);
        }
        window.localStorage.setItem(MIG_KEY, "1");
      }

      // v2 migration: stocks used to have a flat `vesting_schedule: VestEvent[]`.
      // The new schema groups events into named tranches (grants). Wrap any
      // legacy flat schedule into a single "Initial grant" tranche per stock.
      const MIG_V2_KEY = "investor:migration:v2";
      let stocks = stocksRaw ?? [];
      if (typeof window !== "undefined" && !window.localStorage.getItem(MIG_V2_KEY)) {
        let changed = false;
        stocks = stocks.map((s) => {
          const sx = s as unknown as StockHolding & {
            vesting_schedule?: { vest_date: string; shares: number }[];
          };
          if (Array.isArray(sx.tranches)) return s;
          const events = Array.isArray(sx.vesting_schedule) ? sx.vesting_schedule : [];
          changed = true;
          const tranches =
            events.length > 0
              ? [
                  {
                    id: newId(),
                    name: "Initial grant",
                    grant_date: null,
                    vest_events: events,
                    notes: "",
                  },
                ]
              : [];
          const { vesting_schedule: _drop, ...rest } = sx;
          return { ...rest, tranches } as StockHolding;
        });
        if (changed) await saveCollection("stocks", stocks);
        window.localStorage.setItem(MIG_V2_KEY, "1");
      }

      // v3: split legacy `sales` (combined release+sell) into the
      // decoupled `releases` and `sells` arrays. Idempotent — no-op once
      // each holding has anything in the new arrays.
      {
        let changed = false;
        stocks = stocks.map((s) => {
          const migrated = migrateHoldingSales(s);
          if (migrated !== s) changed = true;
          return migrated;
        });
        if (changed) await saveCollection("stocks", stocks);
      }

      // Same migration on the scenario side — old `stock_sales` entries
      // become a scenario release + scenario sell pair.
      {
        let changed = false;
        scenarios = scenarios.map((sc) => {
          const migrated = migrateScenarioSales(sc);
          if (migrated !== sc) changed = true;
          return migrated;
        });
        if (changed) await saveCollection("scenarios", scenarios);
      }

      // v5: strip the vestigial stock_id field from scenario sells —
      // sells are anchored to one named release via release_ref, the
      // stock is derived from the linked release.
      {
        let changed = false;
        scenarios = scenarios.map((sc) => {
          const migrated = dropScenarioSellStockIds(sc);
          if (migrated !== sc) changed = true;
          return migrated;
        });
        if (changed) await saveCollection("scenarios", scenarios);
      }

      // v4: one-shot cleanup of sell entries the previous migration
      // auto-created from legacy combined entries. Those followed the
      // id pattern `${releaseId}-sell`; user-created sells get random
      // ids so they're safe to leave alone. Gated behind a localStorage
      // marker so it only runs once per device.
      const MIG_V4_KEY = "investor:migration:v4-drop-auto-sells";
      if (typeof window !== "undefined" && !window.localStorage.getItem(MIG_V4_KEY)) {
        const isAuto = (id: string) => /-sell$/.test(id);
        let stocksChanged = false;
        stocks = stocks.map((h) => {
          const before = h.sells ?? [];
          const after = before.filter((s) => !isAuto(s.id));
          if (after.length === before.length) return h;
          stocksChanged = true;
          return { ...h, sells: after };
        });
        if (stocksChanged) await saveCollection("stocks", stocks);
        let scenariosChanged = false;
        scenarios = scenarios.map((sc) => {
          const before = sc.sells ?? [];
          const after = before.filter((s) => !isAuto(s.id));
          if (after.length === before.length) return sc;
          scenariosChanged = true;
          return { ...sc, sells: after };
        });
        if (scenariosChanged) await saveCollection("scenarios", scenarios);
        window.localStorage.setItem(MIG_V4_KEY, "1");
      }

      setData({
        stocks,
        properties: properties ?? [],
        scenarios,
        projects: projects ?? [],
        revolvers: revolvers ?? [],
        settings: settings ?? DEFAULT_SETTINGS,
      });
    } catch (e) {
      if (ticket !== inflightLoad.current) return;
      setError((e as Error).message);
    } finally {
      if (ticket === inflightLoad.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // --- Auto-reconnect to Drive ---
  // If the user previously connected (we remembered their email in
  // localStorage) and the client ID is set in settings, try to obtain a
  // fresh access token silently on app load. Google Identity Services'
  // tokenClient with prompt:"" reuses the existing session without a
  // popup when the user is still signed in and has previously granted
  // the drive.file scope. Any failure is swallowed so the user can
  // still hit "Connect Drive" manually.
  const reconnectAttemptedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading) return; // wait until settings are loaded
    if (reconnectAttemptedRef.current) return;
    if (driveToken) return; // already connected
    const clientId = data.settings.google_oauth_client_id?.trim();
    if (!clientId) return;
    const remembered = window.localStorage.getItem(DRIVE_REMEMBER_KEY);
    if (!remembered) return;
    reconnectAttemptedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const t = await requestAccessToken(clientId);
        if (cancelled) return;
        const e = await getAuthorisedEmail(t);
        if (cancelled) return;
        setDriveAuth(t, e);
      } catch {
        // Silent — user signed out of Google, popup blocked, or
        // network issue. They can reconnect manually from Settings.
      }
    })();
    return () => { cancelled = true; };
  }, [loading, driveToken, data.settings.google_oauth_client_id, setDriveAuth]);

  // --- Auto-sync (Drive) ---
  // Debounced push triggered by user edits, pull on tab focus + on connect.
  // Tokens expire after ~1h; on 401 we silently disconnect so the user knows
  // to re-auth before further sync attempts.
  const [autoSync, setAutoSync] = useState<DriveSyncStatus>({ kind: "not_connected" });
  const driveTokenRef = useRef<string | null>(null);
  const dataRef = useRef<CollectionsMap>(data);
  useEffect(() => { driveTokenRef.current = driveToken; }, [driveToken]);
  useEffect(() => { dataRef.current = data; }, [data]);

  const handleAuthError = useCallback((e: unknown): boolean => {
    const msg = (e as Error).message ?? "";
    if (msg.includes(" 401") || msg.includes("Invalid Credentials")) {
      clearDriveAuth();
      setAutoSync({ kind: "error", msg: "Drive session expired — reconnect" });
      return true;
    }
    return false;
  }, [clearDriveAuth]);

  const readLocalDirty = (): boolean => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DRIVE_LOCAL_DIRTY_KEY) === "1";
  };
  const writeLocalDirty = (v: boolean): void => {
    if (typeof window === "undefined") return;
    if (v) window.localStorage.setItem(DRIVE_LOCAL_DIRTY_KEY, "1");
    else window.localStorage.removeItem(DRIVE_LOCAL_DIRTY_KEY);
  };

  // Fetch Drive bundle metadata and compute status against local
  // dirty flag + last-sync timestamp. Never applies the fetched data.
  const recheckSyncStatus = useCallback(async () => {
    const tok = driveTokenRef.current;
    if (!tok) {
      setAutoSync({ kind: "not_connected" });
      return;
    }
    setAutoSync({ kind: "checking" });
    try {
      const raw = await readFromDrive(tok);
      const localDirty = readLocalDirty();
      if (!raw || typeof raw !== "object") {
        setAutoSync({ kind: "drive_empty" });
        return;
      }
      const r = raw as { version?: number; exported_at?: string };
      if (r.version !== 1 || !r.exported_at) {
        setAutoSync({ kind: "drive_empty" });
        return;
      }
      const lastSync = typeof window !== "undefined"
        ? (window.localStorage.getItem(DRIVE_LAST_SYNC_KEY) ?? "")
        : "";
      const driveNewer = r.exported_at > lastSync;
      if (localDirty && driveNewer) {
        setAutoSync({ kind: "diverged", driveExportedAt: r.exported_at });
      } else if (localDirty) {
        setAutoSync({ kind: "local_newer" });
      } else if (driveNewer) {
        setAutoSync({ kind: "drive_newer", driveExportedAt: r.exported_at });
      } else {
        setAutoSync({ kind: "in_sync", at: r.exported_at });
      }
    } catch (e) {
      if (!handleAuthError(e)) {
        setAutoSync({ kind: "error", msg: (e as Error).message });
      }
    }
  }, [handleAuthError]);

  const pushToDrive = useCallback(async () => {
    const tok = driveTokenRef.current;
    if (!tok) throw new Error("Not connected to Drive.");
    setAutoSync({ kind: "checking" });
    try {
      const exported_at = new Date().toISOString();
      const bundle = {
        version: 1 as const,
        exported_at,
        collections: { ...dataRef.current },
      };
      await writeToDrive(tok, bundle);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DRIVE_LAST_SYNC_KEY, exported_at);
      }
      writeLocalDirty(false);
      setAutoSync({ kind: "in_sync", at: exported_at });
    } catch (e) {
      if (!handleAuthError(e)) {
        setAutoSync({ kind: "error", msg: (e as Error).message });
      }
      throw e;
    }
  }, [handleAuthError]);

  const pullFromDrive = useCallback(async () => {
    const tok = driveTokenRef.current;
    if (!tok) throw new Error("Not connected to Drive.");
    setAutoSync({ kind: "checking" });
    try {
      const raw = await readFromDrive(tok);
      if (!raw || typeof raw !== "object") {
        setAutoSync({ kind: "drive_empty" });
        return;
      }
      const r = raw as {
        version?: number;
        exported_at?: string;
        collections?: Partial<CollectionsMap>;
      };
      if (r.version !== 1 || !r.collections) {
        setAutoSync({ kind: "drive_empty" });
        return;
      }
      const c = r.collections;
      const next: CollectionsMap = {
        stocks: c.stocks ?? [],
        properties: c.properties ?? [],
        scenarios: c.scenarios ?? [],
        projects: c.projects ?? [],
        revolvers: (c as CollectionsMap).revolvers ?? [],
        settings: c.settings ?? DEFAULT_SETTINGS,
      };
      await Promise.all([
        saveCollection("stocks", next.stocks),
        saveCollection("properties", next.properties),
        saveCollection("scenarios", next.scenarios),
        saveCollection("projects", next.projects),
        saveCollection("revolvers", next.revolvers),
        saveCollection("settings", next.settings),
      ]);
      setData(next);
      const at = r.exported_at ?? new Date().toISOString();
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DRIVE_LAST_SYNC_KEY, at);
      }
      writeLocalDirty(false);
      setAutoSync({ kind: "in_sync", at });
    } catch (e) {
      if (!handleAuthError(e)) {
        setAutoSync({ kind: "error", msg: (e as Error).message });
      }
      throw e;
    }
  }, [handleAuthError]);

  // On connect (driveToken appears) and on tab-visible focus: just check
  // sync status. Never auto-pull or auto-push — the user picks.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!driveToken) {
      setAutoSync({ kind: "not_connected" });
      return;
    }
    void recheckSyncStatus();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void recheckSyncStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [driveToken, recheckSyncStatus]);

  // Mark the local copy as having unsaved changes relative to Drive.
  // Flips syncStatus to local_newer / diverged so the sync badge in
  // the AppShell + Settings page updates immediately after any edit.
  const markLocalDirty = useCallback(() => {
    writeLocalDirty(true);
    if (!driveTokenRef.current) return;
    setAutoSync((prev) => {
      if (prev.kind === "drive_newer" || prev.kind === "diverged") {
        return { kind: "diverged", driveExportedAt: prev.kind === "diverged" ? prev.driveExportedAt : prev.driveExportedAt };
      }
      return { kind: "local_newer" };
    });
  }, []);

  const persist = useCallback(
    async <K extends keyof CollectionsMap>(key: K, next: CollectionsMap[K]) => {
      setData((prev) => ({ ...prev, [key]: next }));
      try {
        await saveCollection(key, next);
        markLocalDirty();
      } catch (e) {
        setError(`Save ${COLLECTION_FILES[key]} failed: ${(e as Error).message}`);
      }
    },
    [markLocalDirty],
  );

  const setStocks = useCallback((n: StockHolding[]) => persist("stocks", n), [persist]);
  const setProperties = useCallback((n: Property[]) => persist("properties", n), [persist]);
  const setScenarios = useCallback((n: Scenario[]) => persist("scenarios", n), [persist]);
  const setProjects = useCallback((n: InvestmentProject[]) => persist("projects", n), [persist]);
  const setRevolvers = useCallback((n: unknown[]) => persist("revolvers", n), [persist]);
  const setSettings = useCallback((n: Settings) => persist("settings", n), [persist]);

  const loadDemo = useCallback(() => {
    const demo = buildDemoData();
    setData(demo);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("investor:stocks.json", JSON.stringify(demo.stocks));
      window.localStorage.setItem("investor:properties.json", JSON.stringify(demo.properties));
      window.localStorage.setItem("investor:scenarios.json", JSON.stringify(demo.scenarios));
      window.localStorage.setItem("investor:projects.json", JSON.stringify(demo.projects));
      window.localStorage.setItem("investor:revolvers.json", JSON.stringify(demo.revolvers ?? []));
      window.localStorage.setItem("investor:settings.json", JSON.stringify(demo.settings));
    }
  }, []);

  const resetLocal = useCallback(() => {
    clearLocal();
    setData(EMPTY);
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      loading,
      error,
      isDemo: driveToken === null,
      data,
      setStocks,
      setProperties,
      setScenarios,
      setProjects,
      setRevolvers,
      setSettings,
      loadDemo,
      resetLocal,
      reload,
      displayCurrency,
      setDisplayCurrency,
      driveToken,
      driveEmail,
      setDriveAuth,
      clearDriveAuth,
      syncStatus: autoSync,
      recheckSyncStatus,
      pushToDrive,
      pullFromDrive,
    }),
    [loading, error, data, setStocks, setProperties, setScenarios, setProjects, setRevolvers, setSettings, loadDemo, resetLocal, reload, displayCurrency, setDisplayCurrency, driveToken, driveEmail, setDriveAuth, clearDriveAuth, autoSync, recheckSyncStatus, pushToDrive, pullFromDrive],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData must be used within <DataProvider>");
  return v;
}
