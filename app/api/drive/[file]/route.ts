/**
 * Drive proxy: GET /api/drive/<file> -> reads file from user's Drive
 *               PUT /api/drive/<file> -> writes file to user's Drive
 *
 * Access token is read from the Auth.js session (server-side only).
 */

import { auth } from "@/lib/auth";
import { readDriveJson, writeDriveJson } from "@/lib/drive";
import { NextResponse } from "next/server";

const ALLOWED = new Set([
  "stocks.json",
  "properties.json",
  "scenarios.json",
  "projects.json",
  "settings.json",
]);

function fallbackFor(file: string): unknown {
  if (file === "settings.json") return null;
  return [];
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ file: string }> },
) {
  const { file } = await ctx.params;
  if (!ALLOWED.has(file)) return NextResponse.json({ error: "bad file" }, { status: 400 });

  const session = await auth();
  const token = (session as { accessToken?: string } | null)?.accessToken;
  if (!token) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  try {
    const data = await readDriveJson(token, file, fallbackFor(file));
    return NextResponse.json({ data });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json(
      { error: err.message ?? "Drive read failed" },
      { status: err.status ?? 500 },
    );
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ file: string }> },
) {
  const { file } = await ctx.params;
  if (!ALLOWED.has(file)) return NextResponse.json({ error: "bad file" }, { status: 400 });

  const session = await auth();
  const token = (session as { accessToken?: string } | null)?.accessToken;
  if (!token) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  try {
    const body = await req.json();
    await writeDriveJson(token, file, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json(
      { error: err.message ?? "Drive write failed" },
      { status: err.status ?? 500 },
    );
  }
}
