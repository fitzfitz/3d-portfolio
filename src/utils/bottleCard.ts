import type { Bottle } from "./beacons";

/** Fly this close (u, from the bottle's spot) and its read card unrolls (spec "Seeing and reading bottles"). */
export const BOTTLE_CARD_R = 8;
/** A card already up stays until this radius, so a ship hovering on the edge cannot flicker it. */
export const BOTTLE_CARD_EXIT_R = 9.5;
/** Seconds a scanned bottle's card stays up, from anywhere in scan range. */
export const BOTTLE_SCAN_HOLD_S = 6;

export interface BottleScanHold { bottle: Bottle; until: number }

interface Point { x: number; y: number; z: number }
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Which bottle's card to show, or null. The nearest bottle within
 * BOTTLE_CARD_R wins, so with several close by the card follows the nearest.
 * Failing that, the card already up holds until BOTTLE_CARD_EXIT_R, then a
 * recent scan holds until `scan.until`. Only bottles still in `list` count:
 * one hidden or gone from the sky closes its card. `now` is gameTime
 * seconds, the clock Scanner stamps `until` with. Allocates nothing.
 */
export function activeBottle(ship: Point, list: readonly Bottle[], prev: Bottle | null, scan: BottleScanHold | null, now: number): Bottle | null {
  let best: Bottle | null = null;
  let bestD = BOTTLE_CARD_R;
  for (let i = 0; i < list.length; i++) {
    const d = dist(ship, list[i]);
    if (d < bestD) { bestD = d; best = list[i]; }
  }
  if (best) return best;
  if (prev && list.includes(prev) && dist(ship, prev) < BOTTLE_CARD_EXIT_R) return prev;
  return scan && now < scan.until && list.includes(scan.bottle) ? scan.bottle : null;
}

/**
 * Written by Bottles.tsx's frame loop (bottle, own) and Scanner (scan), read
 * by the HUD's BottleCard rAF loop. Never React state, like buoyCardState,
 * so the card costs no renders in flight. bottle null = no card.
 */
export const bottleCardState: { bottle: Bottle | null; own: boolean; scan: BottleScanHold | null } = {
  bottle: null, own: false, scan: null,
};
