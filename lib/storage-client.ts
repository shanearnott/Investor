/**
 * Client-side storage abstraction.
 *
 * Two backends:
 *   - "drive": calls /api/drive/<file> (read/write JSON in user's Drive). Used when signed in.
 *   - "local": writes to localStorage under `investor:<file>`. Used in demo mode.
 *
 * The choice is decided by the caller based on session presence.
 */

"use client";

import { COLLECTION_FILES, type CollectionsMap } from "./models";

const LS_PREFIX = "investor:";

export type StorageBackend = "drive" | "local";

async function readDrive<T>(file: string, fallback: T): Promise<T> {
  const r = await fetch(`/api/drive/${file}`);
  if (r.status === 401) throw new Error("Drive auth expired — please sign in again.");
  if (!r.ok) throw new Error(`Drive read ${file} failed: ${r.status}`);
  const j = (await r.json()) as { data: T };
  return (j.data ?? fallback) as T;
}

async function writeDrive<T>(file: string, data: T): Promise<void> {
  const r = await fetch(`/api/drive/${file}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Drive write ${file} failed: ${r.status}`);
}

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
  backend: StorageBackend,
  key: K,
  fallback: CollectionsMap[K],
): Promise<CollectionsMap[K]> {
  const file = COLLECTION_FILES[key];
  if (backend === "drive") return readDrive(file, fallback);
  return readLocal(file, fallback);
}

export async function saveCollection<K extends keyof CollectionsMap>(
  backend: StorageBackend,
  key: K,
  data: CollectionsMap[K],
): Promise<void> {
  const file = COLLECTION_FILES[key];
  if (backend === "drive") return writeDrive(file, data);
  writeLocal(file, data);
}

export function clearLocal(): void {
  if (typeof window === "undefined") return;
  for (const f of Object.values(COLLECTION_FILES)) {
    window.localStorage.removeItem(LS_PREFIX + f);
  }
}
