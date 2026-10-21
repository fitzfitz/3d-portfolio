import { PLAYER_SHIP_SCALE } from "../constants";
import { SOLAR_BODIES, type SolarBody } from "../data/solarSystem";
import { moonReach, SOLAR_MOONS, type SolarMoon } from "../data/solarMoons";
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
 * A body's solid surface (spec, Bodies: "Solid surfaces"). Planets used to
 * need none, since the orbit lock kept ships off them; they no longer dock
 * (project probes, spec §4.4), so every body collides.
 * If the ship's centre is closer to `center` than `radius` (the body's
 * equatorial size) plus SHIP_HALF_LENGTH, it is pushed out along the normal
 * and an inward velocity is reflected and damped, like the sun's bounce. In
 * place, so the frame loop allocates nothing. True on contact.
 *
 * A check after each step cannot tunnel: the smallest body contact sphere
 * (Ceres, 2.95 + 1.2) is 8.3 across, and the furthest a step goes is warp
 * plus the gravity cap plus the body's own orbital speed (Mercury's at
 * perihelion, the fastest, ~3.4 u/s), (39 + 14 + 3.4) × the 0.05 s dt
 * clamp ≈ 2.8. The moons are smaller and faster: Phobos's contact sphere
 * (0.66 × 1.25 + 1.2) is 4.1 across against a 3.3 step (its 10.6 u/s about
 * Mars included). tests/worldCollide.test.ts checks each body and moon.
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

/**
 * Room the camera keeps past a world's outermost shell. The near plane is
 * 0.1 (R3F's default, GlobalCanvas sets none); its corners reach under 0.3
 * from the eye even at warp's 86° FOV on a 2.5:1 window, so 0.5 keeps the
 * whole near plane outside.
 */
export const CAMERA_CLEARANCE = 0.5;

/**
 * How close the camera may come to a body's centre: its equatorial size (the
 * giants' flattening is polar, so the sphere is conservative), out to its
 * atmosphere's FrontSide shell (`look.atmosphere.thickness`), which culls
 * from inside, plus CAMERA_CLEARANCE. Earth's cloud shell (1.03 R) sits
 * inside its atmosphere's. Rings are fly-through, for the camera as for the ship.
 */
export function bodyCameraRadius(b: SolarBody): number {
  return b.size * (b.look.atmosphere?.thickness ?? 1) + CAMERA_CLEARANCE;
}

/** As bodyCameraRadius for a moon: its reach, out to its haze shell (Titan's), plus CAMERA_CLEARANCE. */
export function moonCameraRadius(m: SolarMoon): number {
  return moonReach(m) * (m.look?.atmosphere?.thickness ?? 1) + CAMERA_CLEARANCE;
}

/** A body the ship cannot fly through: its `bodies` key, its equatorial size, and how close the camera may come to its centre. */
export interface SolidBody { readonly id: string; readonly size: number; readonly cameraR: number }

/**
 * Every solid body: the nine bodies keyed as in `bodies` (project probes spec
 * §4.4), with bodyCameraRadius, then the nine moons keyed as in
 * `moonPositions` (store/moonState.ts), at their reach (moonReach: a sphere
 * moon's size, Phobos's and Deimos's shape tips), the camera kept out to
 * moonCameraRadius (Titan's haze shell). Saturn's and Uranus's rings are fly-through.
 */
export const SOLID_BODIES: readonly SolidBody[] = [
  ...SOLAR_BODIES.map((b) => ({ id: b.id, size: b.size, cameraR: bodyCameraRadius(b) })),
  ...SOLAR_MOONS.map((m) => ({ id: m.id, size: moonReach(m), cameraR: moonCameraRadius(m) })),
];

/**
 * Pushes `p` out to `minR` from `center` if it is inside, along the same
 * direction (straight up if it sits exactly on the centre). In place.
 */
export function keepOutside(p: Vec3, center: Vec3, minR: number): void {
  const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= minR) return;
  if (d < 1e-6) { p.x = center.x; p.y = center.y + minR; p.z = center.z; return; }
  const k = minR / d;
  p.x = center.x + dx * k; p.y = center.y + dy * k; p.z = center.z + dz * k;
}

/**
 * The solid surfaces' purpose (spec, "Solid surfaces"): the camera never ends
 * up inside a body. The collider holds the ship's centre only
 * half a length past the surface, while the chase camera sits 4.6+ behind the
 * nose and lags, so a ship parked nose-out on a body would put the camera
 * inside it. Run after the camera's lerp: pushes `cam` out along the
 * centre-to-camera normal of any body it is inside, to its SOLID_BODIES
 * cameraR. In place, allocation-free; `centers` holds every SOLID_BODIES
 * id (Spaceship passes `bodies` and `moonPositions` merged once); a body
 * missing from it is skipped.
 */
export function keepCameraOutsideBodies(cam: Vec3, centers: Readonly<Record<string, Vec3>>): void {
  for (let i = 0; i < SOLID_BODIES.length; i++) {
    const b = SOLID_BODIES[i];
    const c = centers[b.id];
    if (c) keepOutside(cam, c, b.cameraR);
  }
}
