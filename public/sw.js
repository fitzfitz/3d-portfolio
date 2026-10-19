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
//
// On activate, cached /assets/* files that are not in this build are dropped.
// The list comes from the build (vite.config.ts writes it into BUILD_ASSETS),
// never from what a page loaded: a ?cv visit never loads the 3D engine chunk,
// and pruning by that would break flying offline later.
//
// Kill switch: to retire this worker, deploy this file instead and every
// visitor's next page load removes it:
//
//   self.addEventListener("install", () => self.skipWaiting());
//   self.addEventListener("activate", (e) => e.waitUntil((async () => {
//     for (const k of await caches.keys()) if (k.startsWith("fitz-shell-")) await caches.delete(k);
//     await self.registration.unregister();
//     for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url);
//   })()));
const CACHE = "fitz-shell-v1";
const BUILD_ASSETS = /*__BUILD_ASSETS__*/[];

/** Cached URLs under <scope>assets/ that this build does not ship. */
function staleAssetUrls(cachedUrls, buildAssets, scope) {
  const assets = scope + "assets/";
  const keep = new Set(buildAssets.map((f) => scope + f));
  return cachedUrls.filter((u) => u.startsWith(assets) && !keep.has(u));
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("fitz-shell-") && k !== CACHE) await caches.delete(k);
    // An un-stamped worker (no list) prunes nothing rather than everything.
    if (BUILD_ASSETS.length) {
      const cache = await caches.open(CACHE);
      const cached = (await cache.keys()).map((r) => r.url);
      for (const u of staleAssetUrls(cached, BUILD_ASSETS, self.registration.scope)) await cache.delete(u);
    }
    await self.clients.claim();
  })());
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
