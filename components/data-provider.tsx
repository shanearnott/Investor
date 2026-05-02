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
};

const DISPLAY_CCY_KEY = "investor:displayCurrency";

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

  // Hydrate persisted display-currency choice
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(DISPLAY_CCY_KEY);
    if (v) setDisplayCurrencyState(v);
  }, []);

  const setDisplayCurrency = useCallback((ccy: string) => {
    setDisplayCurrencyState(ccy);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISPLAY_CCY_KEY, ccy);
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

  const persist = useCallback(
    async <K extends keyof CollectionsMap>(key: K, next: CollectionsMap[K]) => {
      setData((prev) => ({ ...prev, [key]: next }));
      try {
        await saveCollection(key, next);
      } catch (e) {
        setError(`Save ${COLLECTION_FILES[key]} failed: ${(e as Error).message}`);
      }
    },
    [],
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
      isDemo: true,
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
    }),
    [loading, error, data, setStocks, setProperties, setScenarios, setProjects, setSettings, loadDemo, resetLocal, reload, displayCurrency, setDisplayCurrency],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData must be used within <DataProvider>");
  return v;
}
