import { parseBeacons, validateDrop, type Beacon, type BeaconDrop } from "./beacons";

/**
 * Where the beacon API lives (beacon-api/), baked in at build time. Empty means
 * the feature does not exist: no fetch, no buoys, no button, no key.
 *
 * Dev builds also accept a localStorage override so the e2e probe can point a
 * running page at a mock without restarting Vite; `import.meta.env.DEV` is a
 * compile-time false in production, so the override is stripped from the bundle.
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

export async function fetchBeacons(): Promise<Beacon[]> {
  const base = beaconApiUrl();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/beacons`);
    if (!res.ok) return [];
    return parseBeacons(await res.json());
  } catch {
    return [];
  }
}

export type DropResult =
  | { ok: true; beacon: Beacon }
  | { ok: false; reason: "rate" | "offline" | "invalid" };

export async function postBeacon(drop: BeaconDrop): Promise<DropResult> {
  const base = beaconApiUrl();
  const v = validateDrop(drop);
  if (!base || !v.ok) return { ok: false, reason: "invalid" };
  try {
    const res = await fetch(`${base}/beacons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v.drop),
    });
    if (res.status === 429) return { ok: false, reason: "rate" };
    if (!res.ok) return { ok: false, reason: res.status === 400 ? "invalid" : "offline" };
    const [beacon] = parseBeacons({ beacons: [(await res.json())?.beacon] });
    return beacon ? { ok: true, beacon } : { ok: false, reason: "offline" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}
