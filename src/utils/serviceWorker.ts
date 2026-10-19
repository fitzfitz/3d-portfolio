/**
 * Registers public/sw.js (production builds only, see main.tsx), which keeps
 * the page, code, styles and fonts so a return visit, or an offline one,
 * needs no network. The asset pack is not its job: utils/assetPack.ts keeps
 * that in its own cache.
 *
 * A worker only sees requests made after it takes control, and this first
 * visit fetched everything before then. So once it is active, the page hands
 * it the same-origin files it already loaded, and the worker caches those.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
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
  });
}
