/**
 * Browser-side Google Drive sync.
 *
 * Uses Google Identity Services for OAuth (popup, no redirect, no server)
 * with the `drive.file` scope. Stores all collections combined into a single
 * `investor-data.json` file in the user's Drive root. The app can only see
 * files it has created/opened with this scope, never the user's other Drive
 * content.
 *
 * Access tokens live in memory only (not persisted) and expire in ~1 hour;
 * the user re-authorises by clicking Connect again. This is the safest model
 * for a static page.
 */

"use client";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FILE_NAME = "investor-data.json";

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: TokenClientConfig) => TokenClient;
          revoke: (token: string, cb?: () => void) => void;
        };
      };
    };
  }
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type TokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (resp: TokenResponse) => void;
  error_callback?: (err: { type?: string; message?: string }) => void;
};

type TokenClient = {
  requestAccessToken: (overrides?: { prompt?: "" | "consent" | "none" }) => void;
};

let scriptPromise: Promise<void> | null = null;

export function loadGisScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load Google Identity Services script"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export async function requestAccessToken(clientId: string): Promise<string> {
  await loadGisScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services failed to initialise");
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.access_token) resolve(resp.access_token);
        else reject(new Error(resp.error_description || resp.error || "No access token returned"));
      },
      error_callback: (err) => reject(new Error(err.message || err.type || "OAuth popup failed")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

export function revokeAccessToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    if (!window.google?.accounts?.oauth2) return resolve();
    window.google.accounts.oauth2.revoke(token, () => resolve());
  });
}

async function api(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function findFile(token: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const r = await api(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=10`,
    token,
  );
  if (!r.ok) throw new Error(`Drive lookup failed: ${r.status} ${await r.text()}`);
  const data = (await r.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

export async function readFromDrive(token: string): Promise<unknown | null> {
  const id = await findFile(token);
  if (!id) return null;
  const r = await api(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
    token,
  );
  if (!r.ok) throw new Error(`Drive read failed: ${r.status}`);
  return r.json();
}

export async function writeToDrive(token: string, data: unknown): Promise<void> {
  const id = await findFile(token);
  const body = JSON.stringify(data, null, 2);
  if (id) {
    const r = await api(
      `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );
    if (!r.ok) throw new Error(`Drive update failed: ${r.status} ${await r.text()}`);
    return;
  }
  // Create new file with metadata + content (multipart)
  const boundary = "investor_b_" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FILE_NAME });
  const multipart =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    meta +
    `\r\n--${boundary}\r\n` +
    "Content-Type: application/json\r\n\r\n" +
    body +
    `\r\n--${boundary}--`;
  const r = await api(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    },
  );
  if (!r.ok) throw new Error(`Drive create failed: ${r.status} ${await r.text()}`);
}

/** Get the currently authorised user's email via the OpenID profile endpoint
 *  (no extra scope needed beyond what the popup already grants for openid).
 *  We didn't request profile so we just read the access token info, which
 *  Google exposes via tokeninfo. Best-effort — failures return null. */
export async function getAuthorisedEmail(token: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`,
    );
    if (!r.ok) return null;
    const data = (await r.json()) as { email?: string };
    return data.email ?? null;
  } catch {
    return null;
  }
}

export const DRIVE_FILE_NAME = FILE_NAME;
