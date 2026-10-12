import type { Vec3 } from "./reactions";

/** Rocks closer than this to the ship get pushed out to it (spec: R ≈ 10u). */
export const BELT_PUSH_RADIUS = 10;
/** Spec: clear the ship's path in ~0.15s... */
export const BELT_PUSH_HALFLIFE = 0.04;
/** ...and spring back over ~2.5s, so the ship leaves a wake that closes behind it. */
export const BELT_RETURN_HALFLIFE = 0.6;

/**
 * The ship's position in a ring's local frame. Each BeltRing sits in a group
 * rotated `tilt` about X, so this applies the inverse rotation, Rx(-tilt).
 */
export function toRingLocal(out: Vec3, p: Vec3, tilt: number): Vec3 {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const y = c * p.y + s * p.z;
  const z = -s * p.y + c * p.z;
  out.x = p.x; out.y = y; out.z = z;
  return out;
}

/**
 * Whether the ship can reach any rock of a ring spanning rMin..rMax from the
 * origin. Distance from the origin is the same in every frame, so this needs
 * no tilt. Most frames the ship is nowhere near a belt and the push is skipped.
 */
export function nearRing(p: Vec3, rMin: number, rMax: number): boolean {
  const r = Math.hypot(p.x, p.y, p.z);
  return r >= rMin - BELT_PUSH_RADIUS && r <= rMax + BELT_PUSH_RADIUS;
}

/**
 * Eases rock `i`'s displacement (disp[i*3 .. i*3+2]) toward its target. A rock
 * whose orbit position (rx, ry, rz) is within the push radius of `ship` (both
 * ring-local) targets the radius surface, directly away from the ship;
 * otherwise it targets zero. Distance is measured from the orbit position, not
 * the displaced one, so a pushed rock holds still rather than oscillating.
 * `kPush`/`kReturn` come from `decay(halfLife, dt)`, computed once per frame.
 */
export function stepRock(
  disp: Float32Array, i: number, rx: number, ry: number, rz: number,
  ship: Vec3 | null, kPush: number, kReturn: number,
): void {
  const j = i * 3;
  let tx = 0, ty = 0, tz = 0, k = kReturn;
  if (ship) {
    let dx = rx - ship.x, dy = ry - ship.y, dz = rz - ship.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < BELT_PUSH_RADIUS) {
      if (d < 1e-6) { dx = 0; dy = 1; dz = 0; } else { dx /= d; dy /= d; dz /= d; }
      const push = BELT_PUSH_RADIUS - d;
      tx = dx * push; ty = dy * push; tz = dz * push;
      k = kPush;
    }
  }
  disp[j] = tx + (disp[j] - tx) * k;
  disp[j + 1] = ty + (disp[j + 1] - ty) * k;
  disp[j + 2] = tz + (disp[j + 2] - tz) * k;
}
