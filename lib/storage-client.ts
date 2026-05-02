/**
 * Client-side storage. localStorage is the source of truth; Drive sync (in
 * `drive-client.ts`) layers on top via the DataProvider's auto-sync engine
 * and pushes/pulls a single combined `investor-data.json`.
 */

"use client";

import { COLLECTION_FILES, type CollectionsMap } from "./models";

const LS_PREFIX = "investor:";

function readLocal<T>(file: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(LS_PREFIX + file);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(file: string, data: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_PREFIX + file, JSON.stringify(data));
}

export async function loadCollection<K extends keyof CollectionsMap>(
  key: K,
  fallback: CollectionsMap[K],
): Promise<CollectionsMap[K]> {
  return readLocal(COLLECTION_FILES[key], fallback);
}

export async function saveCollection<K extends keyof CollectionsMap>(
  key: K,
  data: CollectionsMap[K],
): Promise<void> {
  writeLocal(COLLECTION_FILES[key], data);
}

export function clearLocal(): void {
  if (typeof window === "undefined") return;
  for (const f of Object.values(COLLECTION_FILES)) {
    window.localStorage.removeItem(LS_PREFIX + f);
  }
}
