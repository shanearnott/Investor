/* Lightweight service worker for PWA-installability and basic offline shell.
 * Paths are relative to the SW's location, which sits under the app's basePath
 * on GitHub Pages (e.g. /Investor/sw.js with scope /Investor/).
 *
 * Strategy:
 *   - Navigation/HTML requests: network-first, fall back to cache when offline.
 *     Cache-first was masking deploys (users stuck on stale HTML/JS bundles).
 *   - Other GETs (JS/CSS/images): stale-while-revalidate so the app still loads
 *     offline but updates land on the next visit.
 */
const VERSION = "v3";
const STATIC = `investor-static-${VERSION}`;
const PRECACHE = ["manifest.json", "icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new URL(p, self.registration.scope).href)))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== STATIC).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isHTML(req) {
  if (req.mode === "navigate") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (isHTML(req)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match(new URL("./", self.registration.scope).href))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
