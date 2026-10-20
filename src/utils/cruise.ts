import { SHIP_WARP_SPEED } from "../constants";

/** Free distance (u) at and below which warp keeps its base 39 u/s. */
export const CRUISE_FREE_REF = 60;
/** Warp's top speed in open space, as a multiple of the base warp speed. */
export const CRUISE_MAX_FACTOR = 12;
/** How fast warp builds (u/s^2): 39 to 468 takes about 3 s. */
export const CRUISE_ACCEL = 150;

/**
 * Warp's top speed for `dFree` units of clear space around the ship: the base
 * speed within CRUISE_FREE_REF, growing linearly with the free distance, capped
 * at CRUISE_MAX_FACTOR times the base. The braking distance stays a fixed
 * fraction of the free space, so the ship can always shed speed before it arrives.
 */
export function cruiseLimit(dFree: number): number {
  const v = SHIP_WARP_SPEED * (dFree / CRUISE_FREE_REF);
  return Math.min(SHIP_WARP_SPEED * CRUISE_MAX_FACTOR, Math.max(SHIP_WARP_SPEED, v));
}

/** Warp speed after one frame: rises by at most CRUISE_ACCEL*dt, falls to the limit at once. */
export function stepCruise(current: number, limit: number, dt: number): number {
  return current > limit ? limit : Math.min(limit, current + CRUISE_ACCEL * dt);
}

/**
 * The clear distance from `p` to the nearest sphere surface among the first
 * `count` of `spheres`, or to the system edge (`edgeR - |p|`) if that is nearer.
 * Allocation-free: callers reuse one sphere list across frames.
 */
export function freeDistance(
  p: { x: number; y: number; z: number },
  spheres: readonly { x: number; y: number; z: number; r: number }[],
  count: number,
  edgeR: number,
): number {
  let d = edgeR - Math.hypot(p.x, p.y, p.z);
  for (let i = 0; i < count; i++) {
    const s = spheres[i];
    const e = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) - s.r;
    if (e < d) d = e;
  }
  return d;
}
