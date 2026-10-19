// The site's service worker (registered by src/utils/serviceWorker.ts in
// production builds). Same-origin GETs only; the live sky, beacons and other
// origins always go to the network.
//
// - Page navigations: network first, so a deploy shows up on the next visit;
//   the cached page when offline. The site is one document, so the page is
//   kept under one key (the scope URL) whatever the query (?cv, ?utm_...):
//   per-query copies outlived the code they point at once a deploy pruned it.
// - Hashed build files (/assets/*): cache first. Their names change whenever
//   their content does, so a cached copy is never stale.
// - Anything else same-origin (favicon, og image): the cached copy, refreshed
//   in the background.
// - HTML is only ever cached as the page: the host answers a missing file
//   with index.html and a 200 (Cloudflare's SPA fallback), which must never
//   stand in for a script or a stylesheet.
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

/** Whether a URL is the site's one page (the scope, with any query or index.html). */
function isPage(url, scope) {
  const u = new URL(url);
  const p = new URL(scope).pathname;
  return u.origin === new URL(scope).origin && (u.pathname === p || u.pathname === p + "index.html");
}

/** Cached page copies other than the one under the scope (left by older workers). */
function stalePageUrls(cachedUrls, scope) {
  return cachedUrls.filter((u) => u !== scope && isPage(u, scope));
}

/** A response worth keeping under its own URL: a success that is not HTML. */
function cacheableFile(res) {
  return res.ok && !(res.headers.get("content-type") || "").includes("text/html");
}

/** Stores a fetched response: the page under the scope, other files only when cacheable. */
async function store(url, res) {
  const scope = self.registration.scope;
  const page = isPage(url, scope);
  if (page ? !res.ok : !cacheableFile(res)) return;
  const cache = await caches.open(CACHE);
  await cache.put(page ? scope : url, res);
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("fitz-shell-") && k !== CACHE) await caches.delete(k);
    const cache = await caches.open(CACHE);
    const cached = (await cache.keys()).map((r) => r.url);
    for (const u of stalePageUrls(cached, self.registration.scope)) await cache.delete(u);
    // An un-stamped worker (no list) prunes no assets rather than all of them.
    if (BUILD_ASSETS.length) {
      for (const u of staleAssetUrls(cached, BUILD_ASSETS, self.registration.scope)) await cache.delete(u);
    }
    await self.clients.claim();
  })());
});

// The page lists what it loaded before this worker took control.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-loaded") return;
  const urls = (event.data.urls || []).filter((u) => new URL(u).origin === self.location.origin);
  event.waitUntil(Promise.all(urls.map((u) => fetch(u).then((res) => store(u, res)).catch(() => {}))));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith(".pack")) return;
  /** Hands back the response, keeping a copy (see store) without delaying it. */
  const keep = (res) => {
    event.waitUntil(store(req.url, res.clone()).catch(() => {}));
    return res;
  };

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(keep)
        .catch(() => caches.match(self.registration.scope).then((hit) => hit || Response.error())),
    );
    return;
  }

  if (url.pathname.includes("/assets/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(keep)));
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then(keep).catch(() => hit || Response.error());
      return hit || fresh;
    }),
  );
});
