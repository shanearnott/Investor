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
import { useSession } from "next-auth/react";

import { buildDemoData } from "@/lib/demo-data";
import {
  COLLECTION_FILES,
  SettingsSchema,
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
  type StorageBackend,
} from "@/lib/storage-client";

type DataContextValue = {
  loading: boolean;
  error: string | null;
  backend: StorageBackend;
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
};

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
  const { data: session, status } = useSession();
  const [data, setData] = useState<CollectionsMap>(EMPTY);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [demoForcedLocal, setDemoForcedLocal] = useState<boolean>(false);

  // Backend chooser: signed-in -> drive, else -> local (demo mode)
  const backend: StorageBackend = useMemo(() => {
    if (status === "authenticated" && !demoForcedLocal) return "drive";
    return "local";
  }, [status, demoForcedLocal]);

  const isDemo = backend === "local";

  const inflightLoad = useRef(0);

  const reload = useCallback(async () => {
    if (status === "loading") return;
    const ticket = ++inflightLoad.current;
    setLoading(true);
    setError(null);
    try {
      const [stocks, properties, scenarios, projects, settings] = await Promise.all([
        loadCollection(backend, "stocks", [] as StockHolding[]),
        loadCollection(backend, "properties", [] as Property[]),
        loadCollection(backend, "scenarios", [] as Scenario[]),
        loadCollection(backend, "projects", [] as InvestmentProject[]),
        loadCollection(backend, "settings", DEFAULT_SETTINGS as Settings),
      ]);
      // Bail if a newer reload started
      if (ticket !== inflightLoad.current) return;
      const safeSettings = settings ?? DEFAULT_SETTINGS;
      setData({
        stocks: stocks ?? [],
        properties: properties ?? [],
        scenarios: scenarios ?? [],
        projects: projects ?? [],
        settings: safeSettings,
      });
    } catch (e) {
      if (ticket !== inflightLoad.current) return;
      setError((e as Error).message);
    } finally {
      if (ticket === inflightLoad.current) setLoading(false);
    }
  }, [backend, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persist = useCallback(
    async <K extends keyof CollectionsMap>(key: K, next: CollectionsMap[K]) => {
      setData((prev) => ({ ...prev, [key]: next }));
      try {
        await saveCollection(backend, key, next);
      } catch (e) {
        setError(`Save ${COLLECTION_FILES[key]} failed: ${(e as Error).message}`);
      }
    },
    [backend],
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
    setDemoForcedLocal(true);
  }, []);

  const resetLocal = useCallback(() => {
    clearLocal();
    setData(EMPTY);
  }, []);

  const value = useMemo<DataContextValue>(
    () => ({
      loading,
      error,
      backend,
      isDemo,
      data,
      setStocks,
      setProperties,
      setScenarios,
      setProjects,
      setSettings,
      loadDemo,
      resetLocal,
      reload,
    }),
    [loading, error, backend, isDemo, data, setStocks, setProperties, setScenarios, setProjects, setSettings, loadDemo, resetLocal, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData must be used within <DataProvider>");
  return v;
}

// Helper hook for the user's session-based identity (used in app shell)
export { useSession };
