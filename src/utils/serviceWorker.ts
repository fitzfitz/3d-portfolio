import { startedPackLoad } from "./assetPack";

/**
 * Registers public/sw.js (production builds only, from App's first effect), which keeps
 * the page, code, styles and fonts so a return visit, or an offline one,
 * needs no network. The asset pack is not its job: utils/assetPack.ts keeps
 * that in its own cache.
 *
 * A worker only sees requests made after it takes control, and this first
 * visit fetched everything before then. So once it is active, the page hands
 * it the same-origin files it already loaded, and the worker caches those.
 *
 * That hand-over re-fetches about 1.8 MB of code. Done while the asset packs
 * stream, it took their bandwidth: +0.5 s to the first frame at 2 MB/s
 * (scripts/perf/first-frame-ab.mjs). So registration waits for a pack load
 * the page started; with none (?cv, no WebGL) it goes ahead at once.
 */
export function registerServiceWorker(packs: () => Promise<void> | null = startedPackLoad): void {
  if (!("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const start = () => {
    Promise.resolve(packs())
      .then(() => navigator.serviceWorker.register(`${base}sw.js`, { scope: base }))
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin) && !u.endsWith(".pack"));
        reg.active?.postMessage({ type: "cache-loaded", urls: [location.href, ...urls] });
      })
      .catch(() => {
        // No worker (private mode, blocked): the site works, just not offline.
      });
  };
  // Called from an effect, usually after `load` has fired.
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start);
}
