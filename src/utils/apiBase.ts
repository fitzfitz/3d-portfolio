/**
 * Where the beacon API lives (beacon-api/), baked in at build time. Empty means
 * the API does not exist: no beacons, and the bundled projects and career.
 *
 * Dev builds also accept a localStorage override so the e2e probe can point a
 * running page at a mock without restarting Vite; `import.meta.env.DEV` is a
 * compile-time false in production, so the override is stripped from the bundle.
 *
 * Import-free: the content loader (main.tsx) reads it before any app module.
 */
export function beaconApiUrl(): string {
  if (import.meta.env.DEV) {
    try {
      const o = localStorage.getItem("fitz-beacon-api-dev");
      if (o) return o;
    } catch { /* storage blocked */ }
  }
  return (import.meta.env.VITE_BEACON_API ?? "").replace(/\/+$/, "");
}
