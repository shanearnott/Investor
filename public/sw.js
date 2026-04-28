/* Lightweight service worker for PWA-installability and basic offline shell.
 * Paths are relative to the SW's location, which sits under the app's basePath
 * on GitHub Pages (e.g. /Investor/sw.js with scope /Investor/).
 */
const VERSION = "v2";
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).catch(() => cached)),
  );
});
