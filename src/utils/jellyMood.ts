import { awayFrom, dampVec, type Vec3 } from "./reactions";

export type JellyMood = "calm" | "curious" | "startled";

/**
 * `offset` is added to the path position; `target` is where the offset is
 * easing to. `lastPath` is last frame's path position, used to cancel the
 * path's own drift while curious.
 */
export interface JellyState { mood: JellyMood; offset: Vec3; target: Vec3; startledFor: number; lastPath: Vec3 | null }

/**
 * A planet, as the jellyfish sees it. `r` (its proximity zone plus the
 * creature's body) bounds where it will rest while curious; `body` (planet
 * plus creature radius) is never crossed in any mood.
 */
export interface JellyKeepOut { x: number; y: number; z: number; r: number; body: number }

export interface JellyInput {
  /** Where the path (plus swim surge and bob) puts the jellyfish this frame. */
  pathPos: Vec3;
  /**
   * The path point BEFORE swim surge and bob. Drift cancellation and the
   * curious rest offset are measured from this, so the creature keeps
   * swimming while it holds still against its path. Defaults to `pathPos`.
   */
  basePos?: Vec3;
  player: Vec3;
  playerSpeed: number;
  boosting: boolean;
  keepOut: readonly JellyKeepOut[];
  dt: number;
}

/**
 * The creature's drawn scale: the model is 1.94 x 4.92 x 1.96, so ~3.9 u tall
 * in game, 1.6x the ship (spec 2026-10-23-jellyfish-guide, Size). Was 6 (~30 u).
 */
export const JELLY_SCALE = 0.8;
/**
 * Farthest the creature reaches from its group origin, in model units. Measured
 * from creature.glb: the origin sits near the bell's crown (node y -1.74, bell
 * top +0.72), the tentacle tips hang to y -4.20, and the shader sways them
 * ~0.2 per unit of depth sideways (0.86 at the tips): hypot(4.20, 0.86) = 4.29.
 */
const JELLY_REACH = 4.3;
/**
 * Body radius for keep-outs and clearance: reach from the origin (the point the
 * path and the keep-outs act on) times the scale = 3.44 u. The old "±1 at scale
 * 6, 1.5x" = 9 under-counted a creature whose tips hang 25 u below its origin.
 */
export const JELLY_RADIUS = JELLY_REACH * JELLY_SCALE;
/**
 * Behaviour-feel distances, re-fitted to a ship-sized creature (was 60/18/40/40,
 * tuned to a 30 u one). It notices a slow ship within ~10 body heights; it
 * rests ~2 body heights (~3 ship lengths) off, close enough to look and clear
 * of the hull; a boost startles it inside ~5 body heights; the flee carries
 * it ~8 body heights, a clear dart without leaving the leash.
 */
export const JELLY_CURIOUS_RADIUS = 40;
/** Cruise max is 10.8; under this the player reads as hovering. */
export const JELLY_CURIOUS_MAX_SPEED = 4;
export const JELLY_REST_DIST = 8;
export const JELLY_STARTLE_RADIUS = 20;
export const JELLY_FLEE_DIST = 30;
/** Never more than this from where the path puts it: keeps the rare-sighting rhythm. */
export const JELLY_LEASH = 80;
export const JELLY_STARTLE_SECONDS = 2;
/** A path step longer than this in one frame is a jump (a loop re-phase, a teleport), not drift. */
export const PATH_JUMP = 20;

/** Spec: dart ~1s, follow gently, ease home ~6s (as half-lives). */
const HALF_LIFE: Record<JellyMood, number> = { startled: 0.25, curious: 0.8, calm: 1.5 };

/** Pulse-rate multiplier: calm interest beats slower, fright faster. */
export const JELLY_PULSE_RATE: Record<JellyMood, number> = { calm: 1, curious: 0.8, startled: 1.7 };

export function createJellyState(): JellyState {
  return { mood: "calm", offset: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, startledFor: 0, lastPath: null };
}

const jelly = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };

function setTarget(s: JellyState, x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z);
  const k = l > JELLY_LEASH ? JELLY_LEASH / l : 1;
  s.target.x = x * k; s.target.y = y * k; s.target.z = z * k;
}

/**
 * The keep-out law, shared by the moods and the guide (spec 2026-10-23
 * jellyfish-guide: "keeps clear of every solid, as the keep-out law does
 * today"): a point inside any `body` moves out to that body's surface, away
 * from its centre (straight up from the exact centre, which has no away).
 * Bodies are taken in order, as the moods always did. Mutates `p`; returns
 * whether it moved, so a caller can leave an untouched value bit-exact.
 */
export function pushOutOfSolids(p: Vec3, keepOut: readonly JellyKeepOut[]): boolean {
  let moved = false;
  for (const k of keepOut) {
    const px = p.x - k.x, py = p.y - k.y, pz = p.z - k.z;
    const d = Math.hypot(px, py, pz);
    if (d >= k.body) continue;
    const push = k.body - d;
    moved = true;
    if (d < 1e-6) { p.y += push; continue; }
    p.x += (px / d) * push; p.y += (py / d) * push; p.z += (pz / d) * push;
  }
  return moved;
}

/**
 * One frame of the jellyfish's mood (spec table). A boost within the startle
 * radius beats everything; a startle runs its course; otherwise a slow player
 * close by makes it curious, unless its resting spot would break the leash or
 * sit inside a planet's keep-out, in which case it stays calm.
 */
export function stepJelly(s: JellyState, inp: JellyInput): JellyState {
  const { pathPos, player, dt } = inp;
  const base = inp.basePos ?? pathPos;
  // While curious, hold the creature still in the world against its path's
  // own drift (~3 u/s; 4.6 when this was found): eased against a moving point, the offset lagged ~5u
  // and it parked at ~23u instead of the rest distance. A jump is not drift.
  // Measured on the BASE path: the swim surge and bob ride on top and must
  // survive, or a curious jellyfish freezes mid-stroke.
  if (s.lastPath) {
    const mx = base.x - s.lastPath.x, my = base.y - s.lastPath.y, mz = base.z - s.lastPath.z;
    if (s.mood === "curious" && Math.hypot(mx, my, mz) < PATH_JUMP) {
      s.offset.x -= mx; s.offset.y -= my; s.offset.z -= mz;
    }
    s.lastPath.x = base.x; s.lastPath.y = base.y; s.lastPath.z = base.z;
  } else {
    s.lastPath = { x: base.x, y: base.y, z: base.z };
  }
  jelly.x = pathPos.x + s.offset.x; jelly.y = pathPos.y + s.offset.y; jelly.z = pathPos.z + s.offset.z;
  const dist = Math.hypot(jelly.x - player.x, jelly.y - player.y, jelly.z - player.z);

  if (inp.boosting && dist < JELLY_STARTLE_RADIUS) {
    awayFrom(dir, player, jelly);
    s.mood = "startled";
    s.startledFor = JELLY_STARTLE_SECONDS;
    setTarget(s, s.offset.x + dir.x * JELLY_FLEE_DIST, s.offset.y + dir.y * JELLY_FLEE_DIST, s.offset.z + dir.z * JELLY_FLEE_DIST);
  } else if (s.mood === "startled") {
    s.startledFor -= dt;
    if (s.startledFor <= 0) { s.mood = "calm"; setTarget(s, 0, 0, 0); }
  } else if (dist < JELLY_CURIOUS_RADIUS && inp.playerSpeed < JELLY_CURIOUS_MAX_SPEED && !inp.boosting) {
    awayFrom(dir, player, jelly);
    const rx = player.x + dir.x * JELLY_REST_DIST, ry = player.y + dir.y * JELLY_REST_DIST, rz = player.z + dir.z * JELLY_REST_DIST;
    const ox = rx - base.x, oy = ry - base.y, oz = rz - base.z;
    let blocked = Math.hypot(ox, oy, oz) > JELLY_LEASH;
    for (const k of inp.keepOut) {
      if (Math.hypot(rx - k.x, ry - k.y, rz - k.z) < k.r) { blocked = true; break; }
    }
    if (blocked) { s.mood = "calm"; setTarget(s, 0, 0, 0); }
    else { s.mood = "curious"; setTarget(s, ox, oy, oz); }
  } else {
    s.mood = "calm";
    setTarget(s, 0, 0, 0);
  }

  dampVec(s.offset, s.target, HALF_LIFE[s.mood], dt);
  // Backstop for every mood: a startle can flee toward a planet on the far
  // side, and the eased transit to a rest point can cut a chord through one.
  // Hold the creature's centre on the planet's surface instead. The path
  // itself always clears `body` (tests/planetClearance.test.ts), so a calm
  // jellyfish on its path is never touched (and its offset stays bit-exact).
  jelly.x = pathPos.x + s.offset.x; jelly.y = pathPos.y + s.offset.y; jelly.z = pathPos.z + s.offset.z;
  if (pushOutOfSolids(jelly, inp.keepOut)) {
    s.offset.x = jelly.x - pathPos.x; s.offset.y = jelly.y - pathPos.y; s.offset.z = jelly.z - pathPos.z;
  }
  const l = Math.hypot(s.offset.x, s.offset.y, s.offset.z);
  if (l > JELLY_LEASH) {
    const k = JELLY_LEASH / l;
    s.offset.x *= k; s.offset.y *= k; s.offset.z *= k;
  }
  return s;
}
