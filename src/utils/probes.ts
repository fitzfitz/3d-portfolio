import { PROBES, type ProbeDef, type Vec3T } from "../data/probes";

/**
 * Pure probe logic (docs: project probes design). A probe's "spot" is where
 * it currently floats: 0 is its home, k >= 1 is remote[k - 1]. Spots persist
 * in the visitor's browser, so a stored value is validated on load.
 */

/** Every probe id present; anything that is not a valid spot index becomes 0 (home). */
export function loadProbeSpots(raw: unknown): Record<string, number> {
  const src = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const def of PROBES) {
    const v = src[def.id];
    out[def.id] = typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= def.remote.length ? v : 0;
  }
  return out;
}

/** The spot after relocating: 0 -> 1, k -> k + 1, the last wraps to 1 (a probe never returns home). */
export function nextSpot(def: ProbeDef, spot: number): number {
  return spot >= def.remote.length ? 1 : spot + 1;
}

export function spotPos(def: ProbeDef, spot: number): Vec3T {
  return spot <= 0 ? def.home : def.remote[spot - 1];
}

/** Seconds a closed probe's burn lasts before it vanishes. */
export const RELOCATE_S = 2.5;
/** Distance flown along the burn direction over the whole burn. */
const RELOCATE_DIST = 60;

/** Distance flown after t seconds: ease-in (quadratic), 0 at 0, RELOCATE_DIST at RELOCATE_S. */
export function relocationTravel(t: number): number {
  const k = Math.min(Math.max(t / RELOCATE_S, 0), 1);
  return RELOCATE_DIST * k * k;
}

/** Beacon pulse frequency (Hz): well under the 3 Hz flash limit. */
const BEACON_HZ = 1.2;
/** Soft power so the beacon rests dim and peaks briefly. */
const BEACON_POWER = 1.8;

/** 0..1, smooth, period 1/BEACON_HZ s. `phase` (rad) de-syncs the probes. */
export function beaconLevel(t: number, phase: number): number {
  const base = 0.5 - 0.5 * Math.cos(2 * Math.PI * BEACON_HZ * t + phase);
  return Math.pow(base, BEACON_POWER);
}
