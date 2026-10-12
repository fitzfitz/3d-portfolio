import { COSMIC_BOUNDS } from "../constants";
import { toroidalDistance3 } from "./toroidal";

/** How close the ship must be to scan, measured from the target's surface. */
export const SCAN_RANGE = 22;

/** `radius` is the body's surface radius; 0 for point-like targets. */
export interface Scannable { x: number; y: number; z: number; label: string; radius: number }
const registry = new Map<string, Scannable>();

/**
 * Registers or moves a scannable. Planets pass their size so scan range is
 * measured from the surface: measured from the centre, a 16-unit planet left
 * only ~1 unit between scan range and its orbit-lock radius.
 */
export function setScannable(id: string, x: number, y: number, z: number, label: string, radius = 0) {
  const s = registry.get(id);
  if (s) { s.x = x; s.y = y; s.z = z; s.radius = radius; } else registry.set(id, { x, y, z, label, radius });
}
export function removeScannable(id: string) { registry.delete(id); }
export function nearestScannable(x: number, y: number, z: number, range: number) {
  let best: { id: string; label: string; dist: number } | null = null;
  for (const [id, s] of registry) {
    const d = toroidalDistance3(x, z, y, s.x, s.z, s.y, COSMIC_BOUNDS) - s.radius;
    if (d < range && (!best || d < best.dist)) best = { id, label: s.label, dist: d };
  }
  return best;
}
export function clearScannables() { registry.clear(); } // tests
