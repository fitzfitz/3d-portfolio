import { BUOYS, BUOY_CARD_R, type Vec3 } from "../data/careerTrail";

/** A card shown at BUOY_CARD_R stays up until this radius, so a ship hovering on the edge cannot flicker it. */
export const BUOY_CARD_EXIT_R = 7.5;
/** Seconds a scanned buoy's card stays up, from anywhere in scan range or beyond. */
export const BUOY_SCAN_HOLD_S = 6;

export interface ScanHold { index: number; until: number }

interface Point { x: number; y: number; z: number }
const dist = (s: Point, b: Vec3) => Math.hypot(s.x - b[0], s.y - b[1], s.z - b[2]);

/**
 * Which buoy's card to show (spec §2, "Buoy cards"), or null. A card already
 * up is kept until BUOY_CARD_EXIT_R. Otherwise the nearest buoy within
 * BUOY_CARD_R wins. Failing both, a recent scan is held until `scan.until`.
 * `now` is gameTime seconds, the clock Scanner stamps `until` with.
 */
export function activeBuoy(ship: Point, buoys: readonly Vec3[], prev: number | null, scan: ScanHold | null, now: number): number | null {
  if (prev !== null && buoys[prev] && dist(ship, buoys[prev]) < BUOY_CARD_EXIT_R) return prev;
  let best: number | null = null;
  let bestD = BUOY_CARD_R;
  for (let i = 0; i < buoys.length; i++) {
    const d = dist(ship, buoys[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best !== null) return best;
  return scan && now < scan.until ? scan.index : null;
}

/** The buoy index in a scannable id ("career_3" → 3), or -1 if it is not one. */
export function buoyIndex(id: string): number {
  const m = /^career_(\d+)$/.exec(id);
  const i = m ? Number(m[1]) : -1;
  return i >= 0 && i < BUOYS.length ? i : -1;
}

/**
 * Written by CareerTrail's frame loop (index) and Scanner (scan), read by the
 * HUD's BuoyCard rAF loop. Never React state, like waypointState, so the card
 * costs no renders during flight. index -1 = no card.
 */
export const buoyCardState: { index: number; scan: ScanHold | null } = { index: -1, scan: null };
