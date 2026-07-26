import { COSMIC_BOUNDS } from "../constants";

/** A sphere spawns must stay clear of — a planet, the portal, or the ship. */
export interface AvoidPoint { x: number; y: number; z: number; r: number }

/** Slots in the field. Mean spacing at this count is ~146 units. */
export const CRYSTAL_MAX = 40;

/** Seconds between respawns while below the cap. */
export const CRYSTAL_RESPAWN_SECONDS = 4;

/** Ship-to-crystal distance that collects it. Matches the shard radius. */
export const CRYSTAL_PICKUP_RADIUS = 3;

/** Main asteroid belt band, distance from origin (AsteroidBelt.tsx:110). */
const BELT_MIN = 40;
const BELT_MAX = 70;
/** Polar halo band, same file (line 115). */
const HALO_MIN = 80;
const HALO_MAX = 95;

/** Attempts before accepting a rejected candidate rather than hanging. */
const MAX_ATTEMPTS = 20;

/**
 * True if a candidate position is somewhere a crystal must not appear: inside
 * the asteroid bands where it would be buried in rock, or too close to a body
 * the player is navigating around.
 *
 * Every test is full 3D distance from the origin, NOT XZ radius. Both belt rings
 * are tilted — `BeltMain` by 0.436 rad and `BeltHalo` by 1.31 rad — and rotating
 * a ring preserves each rock's distance from the origin while changing its XZ
 * radius completely. The 75-degree halo at ring radius 88 climbs to y ~= 85 at an
 * XZ radius of ~22, so an XZ test would drop crystals right into the halo it was
 * meant to exclude. Distance from origin is the tilt-invariant measure, and it is
 * what the spec means by "radius 40-70 from origin".
 */
export function isRejectedSpawn(x: number, y: number, z: number, avoid: AvoidPoint[]): boolean {
  const originR = Math.hypot(x, y, z);
  if (originR >= BELT_MIN && originR <= BELT_MAX) return true;
  if (originR >= HALO_MIN && originR <= HALO_MAX) return true;
  for (const a of avoid) {
    if (Math.hypot(x - a.x, y - a.y, z - a.z) < a.r) return true;
  }
  return false;
}

/**
 * A random position in the volume that passes `isRejectedSpawn`.
 *
 * `rand` is injected rather than calling Math.random directly so the placement
 * is testable deterministically. After MAX_ATTEMPTS it returns the last
 * candidate regardless: a crystal in a slightly awkward spot is far better than
 * a frame loop that hangs, and the caller cannot tell the difference.
 */
export function randomCrystalPos(rand: () => number, avoid: AvoidPoint[]): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    x = (rand() * 2 - 1) * COSMIC_BOUNDS;
    y = (rand() * 2 - 1) * COSMIC_BOUNDS;
    z = (rand() * 2 - 1) * COSMIC_BOUNDS;
    if (!isRejectedSpawn(x, y, z, avoid)) break;
  }
  return [x, y, z];
}

/**
 * Accumulator-driven respawn timing. Returns how many crystals are due and the
 * leftover time to carry forward.
 *
 * An accumulator rather than setInterval so it pauses with the tab and stays in
 * step with delta time. It returns a COUNT rather than a boolean so a large dt
 * spike owes the right number of spawns instead of silently dropping them.
 */
export function respawnTick(accum: number, dt: number): { spawns: number; accum: number } {
  const total = accum + dt;
  const spawns = Math.floor(total / CRYSTAL_RESPAWN_SECONDS);
  return { spawns, accum: total - spawns * CRYSTAL_RESPAWN_SECONDS };
}
