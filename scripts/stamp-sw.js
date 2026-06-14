#!/usr/bin/env node
/* Stamp the exported service worker with a unique build id so every deploy
 * gets a fresh cache name. Runs as `postbuild` so it always fires after a
 * `next build`, locally or in CI. Uses GITHUB_SHA when available, falls back
 * to a millisecond timestamp. No-ops if the file or placeholder is missing
 * (e.g. someone ran `next build` without the static-export step). */

const fs = require("fs");
const path = require("path");

const swPath = path.resolve(__dirname, "..", "out", "sw.js");
if (!fs.existsSync(swPath)) {
  console.log(`[stamp-sw] ${swPath} not found — skipping.`);
  process.exit(0);
}

const id = (process.env.GITHUB_SHA || "").slice(0, 7) || `local-${Date.now()}`;
const src = fs.readFileSync(swPath, "utf8");
if (!src.includes("__BUILD_ID__")) {
  console.log(`[stamp-sw] placeholder already replaced — skipping.`);
  process.exit(0);
}
const out = src.replace(/__BUILD_ID__/g, id);
fs.writeFileSync(swPath, out);
console.log(`[stamp-sw] cache version = ${id}`);
