#!/usr/bin/env node
/* Emit .env.production.local with a NEXT_PUBLIC_BUILD_ID. Next.js inlines
 * NEXT_PUBLIC_* env vars into client bundles, so sw-register can append it
 * as a cache-busting query string when registering the service worker.
 * Runs as `prebuild` and is gitignored. */

const fs = require("fs");
const path = require("path");

const id = (process.env.GITHUB_SHA || "").slice(0, 7) || `local-${Date.now()}`;
const time = new Date().toISOString();
const out = path.resolve(__dirname, "..", ".env.production.local");
fs.writeFileSync(
  out,
  `NEXT_PUBLIC_BUILD_ID=${id}\nNEXT_PUBLIC_BUILD_TIME=${time}\n`,
);
console.log(`[set-build-id] NEXT_PUBLIC_BUILD_ID=${id} NEXT_PUBLIC_BUILD_TIME=${time}`);
