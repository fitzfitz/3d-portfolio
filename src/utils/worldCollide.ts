import { PLAYER_SHIP_SCALE } from "../constants";
import { WORLDS, type WorldData } from "../data/worlds";
import { keepOutside } from "./capture";
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

/** The ice giants' scattering shell, as a multiple of the size (SpaceWorlds' Atmosphere `thickness`). */
export const ICE_GIANT_SHELL = 1.04;

/**
 * Room the camera keeps past a world's outermost shell. The near plane is
 * 0.1 (R3F's default, GlobalCanvas sets none); its corners reach under 0.3
 * from the eye even at warp's 86° FOV on a 2.5:1 window, so 0.5 keeps the
 * whole near plane outside.
 */
export const CAMERA_CLEARANCE = 0.5;

/**
 * How close the camera may come to a world's centre: its equatorial size
 * (the ringed giant's flattening is polar, so the sphere is conservative),
 * out to the ice giants' FrontSide shell, which culls from inside, plus
 * CAMERA_CLEARANCE. The rings are fly-through, for the camera as for the ship.
 */
export function worldCameraRadius(w: WorldData): number {
  return w.size * (w.type === "ice-giant" ? ICE_GIANT_SHELL : 1) + CAMERA_CLEARANCE;
}

const CAMERA_RADII = WORLDS.map(worldCameraRadius);

/**
 * The solid surfaces' purpose (spec, "Solid surfaces"): the camera never ends
 * up inside a world. The collider holds the ship's centre only half a length
 * past the surface, while the chase camera sits 4.6+ behind the nose and lags,
 * so a ship parked nose-out on a world would put the camera inside it. Run
 * after the camera's lerp: pushes `cam` out along the centre-to-camera normal
 * of any world it is inside, to worldCameraRadius. In place, allocation-free;
 * `centers` is `bodies`, keyed by world id.
 */
export function keepCameraOutsideWorlds(cam: Vec3, centers: Readonly<Record<string, Vec3>>): void {
  for (let i = 0; i < WORLDS.length; i++) {
    const c = centers[WORLDS[i].id];
    if (c) keepOutside(cam, c, CAMERA_RADII[i]);
  }
}
