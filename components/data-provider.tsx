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
import { readFromDrive, writeToDrive } from "@/lib/drive-client";
import {
  COLLECTION_FILES,
  SettingsSchema,
  newId,
  type CollectionsMap,
  type InvestmentProject,
  type Property,
  type Scenario,
  type Settings,
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
  /** Live auto-sync status (debounced push + pull-on-focus). */
  autoSync: AutoSyncStatus;
};

export type AutoSyncStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "pushing" }
  | { kind: "pulling" }
  | { kind: "ok"; at: string; direction: "push" | "pull" }
  | { kind: "error"; msg: string };

const DISPLAY_CCY_KEY = "investor:displayCurrency";
const DRIVE_TOKEN_KEY = "investor:driveToken";
const DRIVE_EMAIL_KEY = "investor:driveEmail";
const DRIVE_LAST_SYNC_KEY = "investor:driveLastSync";
const PUSH_DEBOUNCE_MS = 3000;

const Ctx = createContext<DataContextValue | null>(null);

const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

const EMPTY: CollectionsMap = {
  stocks: [],
  properties: [],
  scenarios: [],
  projects: [],
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
      if (email) window.sessionStorage.setItem(DRIVE_EMAIL_KEY, email);
      else window.sessionStorage.removeItem(DRIVE_EMAIL_KEY);
    }
  }, []);

  const clearDriveAuth = useCallback(() => {
    setDriveTokenState(null);
    setDriveEmailState(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(DRIVE_TOKEN_KEY);
      window.sessionStorage.removeItem(DRIVE_EMAIL_KEY);
    }
  }, []);

  const inflightLoad = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++inflightLoad.current;
    setLoading(true);
    setError(null);
    try {
      const [stocksRaw, properties, scenariosRaw, projects, settings] = await Promise.all([
        loadCollection("stocks", [] as StockHolding[]),
        loadCollection("properties", [] as Property[]),
        loadCollection("scenarios", [] as Scenario[]),
        loadCollection("projects", [] as InvestmentProject[]),
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

      setData({
        stocks,
        properties: properties ?? [],
        scenarios,
        projects: projects ?? [],
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

  // --- Auto-sync (Drive) ---
  // Debounced push triggered by user edits, pull on tab focus + on connect.
  // Tokens expire after ~1h; on 401 we silently disconnect so the user knows
  // to re-auth before further sync attempts.
  const [autoSync, setAutoSync] = useState<AutoSyncStatus>({ kind: "idle" });
  const driveTokenRef = useRef<string | null>(null);
  const dataRef = useRef<CollectionsMap>(data);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushInFlightRef = useRef<boolean>(false);
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

  const flushPush = useCallback(async () => {
    const tok = driveTokenRef.current;
    if (!tok) return;
    if (pushInFlightRef.current) return;
    pushInFlightRef.current = true;
    setAutoSync({ kind: "pushing" });
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
      setAutoSync({ kind: "ok", at: exported_at, direction: "push" });
    } catch (e) {
      if (!handleAuthError(e)) setAutoSync({ kind: "error", msg: (e as Error).message });
    } finally {
      pushInFlightRef.current = false;
    }
  }, [handleAuthError]);

  const schedulePush = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!driveTokenRef.current) return;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    setAutoSync({ kind: "pending" });
    pushTimerRef.current = setTimeout(() => {
      pushTimerRef.current = null;
      void flushPush();
    }, PUSH_DEBOUNCE_MS);
  }, [flushPush]);

  // Pull on connect + tab focus. Skips if a push is pending/in-flight (local
  // changes are newer). Bundle's exported_at vs DRIVE_LAST_SYNC_KEY decides
  // whether remote actually has anything newer than what we last synced.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!driveToken) return;

    const pull = async () => {
      if (pushTimerRef.current || pushInFlightRef.current) return;
      const tok = driveTokenRef.current;
      if (!tok) return;
      try {
        setAutoSync({ kind: "pulling" });
        const raw = await readFromDrive(tok);
        if (!raw || typeof raw !== "object") {
          setAutoSync({ kind: "idle" });
          return;
        }
        const r = raw as { version?: number; exported_at?: string; collections?: Partial<CollectionsMap> };
        if (r.version !== 1 || !r.collections) {
          setAutoSync({ kind: "idle" });
          return;
        }
        const lastSync = window.localStorage.getItem(DRIVE_LAST_SYNC_KEY) ?? "";
        if (r.exported_at && r.exported_at <= lastSync) {
          setAutoSync({ kind: "idle" });
          return;
        }
        const c = r.collections;
        const next: CollectionsMap = {
          stocks: c.stocks ?? [],
          properties: c.properties ?? [],
          scenarios: c.scenarios ?? [],
          projects: c.projects ?? [],
          settings: c.settings ?? DEFAULT_SETTINGS,
        };
        await Promise.all([
          saveCollection("stocks", next.stocks),
          saveCollection("properties", next.properties),
          saveCollection("scenarios", next.scenarios),
          saveCollection("projects", next.projects),
          saveCollection("settings", next.settings),
        ]);
        setData(next);
        if (r.exported_at) window.localStorage.setItem(DRIVE_LAST_SYNC_KEY, r.exported_at);
        setAutoSync({ kind: "ok", at: r.exported_at ?? new Date().toISOString(), direction: "pull" });
      } catch (e) {
        if (!handleAuthError(e)) setAutoSync({ kind: "error", msg: (e as Error).message });
      }
    };

    void pull();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [driveToken, handleAuthError]);

  // Push any pending changes on tab hide/unload — best-effort, browsers may
  // cancel in-flight fetches but the timer would otherwise drop them entirely.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHide = () => {
      if (pushTimerRef.current) {
        clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
        void flushPush();
      }
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onHide();
    });
    return () => window.removeEventListener("pagehide", onHide);
  }, [flushPush]);

  const persist = useCallback(
    async <K extends keyof CollectionsMap>(key: K, next: CollectionsMap[K]) => {
      setData((prev) => ({ ...prev, [key]: next }));
      try {
        await saveCollection(key, next);
        schedulePush();
      } catch (e) {
        setError(`Save ${COLLECTION_FILES[key]} failed: ${(e as Error).message}`);
      }
    },
    [schedulePush],
  );

  const setStocks = useCallback((n: StockHolding[]) => persist("stocks", n), [persist]);
  const setProperties = useCallback((n: Property[]) => persist("properties", n), [persist]);
  const setScenarios = useCallback((n: Scenario[]) => persist("scenarios", n), [persist]);
  const setProjects = useCallback((n: InvestmentProject[]) => persist("projects", n), [persist]);
  const setSettings = useCallback((n: Settings) => persist("settings", n), [persist]);

  const loadDemo = useCallback(() => {
    const demo = buildDemoData();
    setData(demo);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("investor:stocks.json", JSON.stringify(demo.stocks));
      window.localStorage.setItem("investor:properties.json", JSON.stringify(demo.properties));
      window.localStorage.setItem("investor:scenarios.json", JSON.stringify(demo.scenarios));
      window.localStorage.setItem("investor:projects.json", JSON.stringify(demo.projects));
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
      autoSync,
    }),
    [loading, error, data, setStocks, setProperties, setScenarios, setProjects, setSettings, loadDemo, resetLocal, reload, displayCurrency, setDisplayCurrency, driveToken, driveEmail, setDriveAuth, clearDriveAuth, autoSync],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData must be used within <DataProvider>");
  return v;
}
