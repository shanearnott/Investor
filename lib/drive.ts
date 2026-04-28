/**
 * Google Drive REST helpers (no SDK).
 *
 * Storage layout in the user's Drive (only files this app creates/opens are visible to it):
 *   /Investor App/
 *     stocks.json
 *     properties.json
 *     scenarios.json
 *     projects.json
 *     settings.json
 *
 * The folder is auto-created on first write.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_NAME = "Investor App";

class DriveError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

async function api(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  const r = await fetch(url, { ...init, headers });
  if (r.status === 401) throw new DriveError(401, "Drive auth expired");
  return r;
}

async function findFolder(accessToken: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const r = await api(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name)&pageSize=10`,
    accessToken,
  );
  if (!r.ok) throw new DriveError(r.status, `Folder lookup failed: ${await r.text()}`);
  const data = (await r.json()) as { files: { id: string; name: string }[] };
  return data.files?.[0]?.id ?? null;
}

async function createFolder(accessToken: string): Promise<string> {
  const r = await api(`${DRIVE_API}/files`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  if (!r.ok) throw new DriveError(r.status, `Folder create failed: ${await r.text()}`);
  const data = (await r.json()) as { id: string };
  return data.id;
}

async function ensureFolder(accessToken: string): Promise<string> {
  return (await findFolder(accessToken)) ?? (await createFolder(accessToken));
}

async function findFile(
  accessToken: string,
  folderId: string,
  name: string,
): Promise<string | null> {
  const q = encodeURIComponent(`'${folderId}' in parents and name='${name}' and trashed=false`);
  const r = await api(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name)&pageSize=10`,
    accessToken,
  );
  if (!r.ok) throw new DriveError(r.status, `File lookup failed: ${await r.text()}`);
  const data = (await r.json()) as { files: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

export async function readDriveJson<T>(
  accessToken: string,
  filename: string,
  fallback: T,
): Promise<T> {
  const folderId = await findFolder(accessToken);
  if (!folderId) return fallback;
  const fileId = await findFile(accessToken, folderId, filename);
  if (!fileId) return fallback;
  const r = await api(`${DRIVE_API}/files/${fileId}?alt=media`, accessToken);
  if (!r.ok) {
    if (r.status === 404) return fallback;
    throw new DriveError(r.status, `Read failed: ${await r.text()}`);
  }
  try {
    return (await r.json()) as T;
  } catch {
    return fallback;
  }
}

export async function writeDriveJson<T>(
  accessToken: string,
  filename: string,
  data: T,
): Promise<void> {
  const folderId = await ensureFolder(accessToken);
  const existing = await findFile(accessToken, folderId, filename);
  const body = JSON.stringify(data, null, 2);

  if (existing) {
    // Update content
    const r = await api(
      `${DRIVE_UPLOAD}/files/${existing}?uploadType=media`,
      accessToken,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );
    if (!r.ok) throw new DriveError(r.status, `Update failed: ${await r.text()}`);
  } else {
    // Multipart create with metadata + content
    const boundary = "investor_boundary_" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: filename, parents: [folderId] });
    const multipart =
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      meta +
      `\r\n--${boundary}\r\n` +
      "Content-Type: application/json\r\n\r\n" +
      body +
      `\r\n--${boundary}--`;
    const r = await api(`${DRIVE_UPLOAD}/files?uploadType=multipart`, accessToken, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    });
    if (!r.ok) throw new DriveError(r.status, `Create failed: ${await r.text()}`);
  }
}
