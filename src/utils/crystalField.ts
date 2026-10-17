import { SYSTEM_RADIUS, LOCK_RETAIN_FACTOR } from "../constants";
import { DESTINATIONS } from "../data/destinations";
import { GATE_POS } from "../data/dormantGate";

/** A sphere spawns must stay clear of — a planet, a landmark, or the ship. */
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
 * Keep-out around each landmark (every destination and the dormant gate, CRYSTAL_LANDMARKS),
 * well outside their lock radii, so collecting a crystal never docks you;
 * and around the ship, so crystals never pop into view.
 */
export const LANDMARK_KEEP_OUT = 20;

/** Fixed landmarks a crystal spawn keeps LANDMARK_KEEP_OUT from: every destination, and the gate's frame (radius 15). */
export const CRYSTAL_LANDMARKS: readonly (readonly [number, number, number])[] = [...DESTINATIONS.map((d) => d.pos), GATE_POS];
const SHIP_KEEP_OUT = 30;

/**
 * Spheres a crystal spawn must avoid. A planet's keep-out follows its size:
 * its lock-retain radius plus the pickup radius, so collecting a crystal never
 * drags the ship into orbit lock. A fixed radius here went stale the moment
 * planets grew past it.
 */
export function crystalAvoidPoints(
  planetBodies: readonly { x: number; y: number; z: number; size: number }[],
  landmarks: readonly (readonly [number, number, number])[],
  ship: { x: number; y: number; z: number },
): AvoidPoint[] {
  return [
    ...planetBodies.map((b) => ({ x: b.x, y: b.y, z: b.z, r: b.size * LOCK_RETAIN_FACTOR + CRYSTAL_PICKUP_RADIUS })),
    ...landmarks.map((p) => ({ x: p[0], y: p[1], z: p[2], r: LANDMARK_KEEP_OUT })),
    { x: ship.x, y: ship.y, z: ship.z, r: SHIP_KEEP_OUT },
  ];
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
    x = (rand() * 2 - 1) * SYSTEM_RADIUS;
    y = (rand() * 2 - 1) * SYSTEM_RADIUS;
    z = (rand() * 2 - 1) * SYSTEM_RADIUS;
    // Rejection-sample the cube down to the ball: uniform in the system sphere.
    if (x * x + y * y + z * z > SYSTEM_RADIUS * SYSTEM_RADIUS) continue;
    if (!isRejectedSpawn(x, y, z, avoid)) return [x, y, z];
  }
  // Out of attempts: keep the last candidate, pulled inside the sphere if it fell outside.
  const r = Math.hypot(x, y, z);
  if (r > SYSTEM_RADIUS) { const k = SYSTEM_RADIUS / r; x *= k; y *= k; z *= k; }
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
