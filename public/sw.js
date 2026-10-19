// The site's service worker (registered by src/utils/serviceWorker.ts in
// production builds). Same-origin GETs only; the live sky, beacons and other
// origins always go to the network.
//
// - Page navigations: network first, so a deploy shows up on the next visit;
//   the cached page when offline.
// - Hashed build files (/assets/*): cache first. Their names change whenever
//   their content does, so a cached copy is never stale.
// - Anything else same-origin (favicon, og image): the cached copy, refreshed
//   in the background.
// - The asset pack (*.pack) is skipped: src/utils/assetPack.ts caches it itself.
const CACHE = "fitz-shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fitz-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page lists what it loaded before this worker took control.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-loaded") return;
  const urls = (event.data.urls || []).filter((u) => new URL(u).origin === self.location.origin);
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(urls.map((u) => cache.add(u).catch(() => {})))));
});

const keep = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith(".pack")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => keep(req, res))
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match(self.registration.scope))),
    );
    return;
  }

  if (url.pathname.includes("/assets/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => keep(req, res)).catch(() => hit || Response.error());
      return hit || fresh;
    }),
  );
});
