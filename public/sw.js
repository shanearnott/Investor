/* Lightweight service worker for PWA-installability and basic offline shell.
 * We don't aggressively cache app routes (data depends on Drive/auth) — the goal
 * is just to satisfy the installability criteria and serve the manifest/icons.
 */
const VERSION = "v1";
const STATIC = `investor-static-${VERSION}`;
const PRECACHE = ["/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC).then((cache) => cache.addAll(PRECACHE)).catch(() => {}),
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
  const url = new URL(req.url);
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req)),
    );
  }
});
