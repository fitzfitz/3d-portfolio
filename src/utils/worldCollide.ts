import { PLAYER_SHIP_SCALE } from "../constants";
import type { Vec3 } from "./reactions";

/**
 * Half the hero ship's length: spaceship.glb spans z ±3.5 (its v1 footprint,
 * tests/assetContracts.test.ts), drawn at PLAYER_SHIP_SCALE. The ship's
 * origin is its centre, so its nose reaches this far ahead of it.
 */
export const SHIP_HALF_LENGTH = 3.5 * PLAYER_SHIP_SCALE;

/** Speed kept after a bounce, and the gap left past the surface: the sun's (utils/collision.ts). */
const DAMP = 0.45;
const SKIN = 0.05;

/**
 * A world's solid surface (spec, Bodies: "Solid surfaces"). Planets need no
 * collider, since the orbit lock keeps ships off them; worlds have no lock.
 * If the ship's centre is closer to `center` than `radius` (the world's
 * equatorial size) plus SHIP_HALF_LENGTH, it is pushed out along the normal
 * and an inward velocity is reflected and damped, like the sun's bounce. In
 * place, so the frame loop allocates nothing. True on contact.
 *
 * A check after each step cannot tunnel: the smallest contact sphere (the
 * dwarf, 3.5 + 1.2) is 9.4 across, and the furthest a step goes is warp plus
 * the gravity cap, (39 + 14) × the 0.05 s dt clamp ≈ 2.7.
 */
export function resolveWorldContact(pos: Vec3, vel: Vec3, center: Vec3, radius: number): boolean {
  const reach = radius + SHIP_HALF_LENGTH;
  let nx = pos.x - center.x, ny = pos.y - center.y, nz = pos.z - center.z;
  const d = Math.hypot(nx, ny, nz);
  if (d >= reach) return false;
  if (d < 1e-6) { nx = 1; ny = 0; nz = 0; } else { nx /= d; ny /= d; nz /= d; }
  const vn = vel.x * nx + vel.y * ny + vel.z * nz;
  // Only an inward velocity reflects: one already leaving (a world moving
  // onto the ship) is left as it is.
  if (vn < 0) {
    vel.x = (vel.x - 2 * vn * nx) * DAMP;
    vel.y = (vel.y - 2 * vn * ny) * DAMP;
    vel.z = (vel.z - 2 * vn * nz) * DAMP;
  }
  const out = reach + SKIN;
  pos.x = center.x + nx * out;
  pos.y = center.y + ny * out;
  pos.z = center.z + nz * out;
  return true;
}
