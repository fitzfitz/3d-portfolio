import type { Vec3 } from "./reactions";

/**
 * The chase camera's framing (Spaceship's applyChaseCam): how far behind the
 * nose and how high above the ship it sits. Cruise eases back by `speedGain`
 * at full throttle; warp pulls further back and up.
 */
export const CHASE_CAM = {
  distance: 4.6,
  speedGain: 0.6,
  height: 1.8,
  warpDistance: 6.8,
  warpHeight: 2.8,
} as const;

/** Behind the ship by `distance` along `nose`, `height` up, plus a sideways `side` offset. In place into `out`. */
export function chaseCamTarget(out: Vec3, pos: Vec3, nose: Vec3, distance: number, height: number, side: Vec3): Vec3 {
  out.x = pos.x - nose.x * distance + side.x;
  out.y = pos.y - nose.y * distance + height + side.y;
  out.z = pos.z - nose.z * distance + side.z;
  return out;
}
