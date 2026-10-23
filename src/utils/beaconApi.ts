import { parseBeacons, validateDrop, type Beacon, type BeaconDrop } from "./beacons";
import { beaconApiUrl } from "./apiBase";

/** Re-exported: the URL lives in apiBase.ts so the content loader can read it without loading beacons.ts. */
export { beaconApiUrl };

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

/** `invalid` is a local validation failure (spawn pad); `refused` is a server 400. */
export type DropResult =
  | { ok: true; beacon: Beacon }
  | { ok: false; reason: "rate" | "offline" | "invalid" | "refused" };

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
    if (!res.ok) return { ok: false, reason: res.status === 400 ? "refused" : "offline" };
    const [beacon] = parseBeacons({ beacons: [(await res.json())?.beacon] });
    return beacon ? { ok: true, beacon } : { ok: false, reason: "offline" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}
