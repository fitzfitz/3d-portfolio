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

/** Body radius: creature.glb spans ±1, drawn at scale 6, sway-padded 1.5x. */
export const JELLY_RADIUS = 9;
export const JELLY_CURIOUS_RADIUS = 60;
/** Cruise max is 10.8; under this the player reads as hovering. */
export const JELLY_CURIOUS_MAX_SPEED = 4;
export const JELLY_REST_DIST = 18;
export const JELLY_STARTLE_RADIUS = 40;
export const JELLY_FLEE_DIST = 40;
/** Never more than this from where the path puts it: keeps the rare-sighting rhythm. */
export const JELLY_LEASH = 80;
export const JELLY_STARTLE_SECONDS = 2;
/** A path step longer than this in one frame is a jump (the J summon), not drift. */
const PATH_JUMP = 20;

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
  // jellyfish on its path is never touched.
  for (const k of inp.keepOut) {
    const px = pathPos.x + s.offset.x - k.x, py = pathPos.y + s.offset.y - k.y, pz = pathPos.z + s.offset.z - k.z;
    const d = Math.hypot(px, py, pz);
    if (d >= k.body) continue;
    const push = k.body - d;
    if (d < 1e-6) { s.offset.y += push; continue; }
    s.offset.x += (px / d) * push; s.offset.y += (py / d) * push; s.offset.z += (pz / d) * push;
  }
  const l = Math.hypot(s.offset.x, s.offset.y, s.offset.z);
  if (l > JELLY_LEASH) {
    const k = JELLY_LEASH / l;
    s.offset.x *= k; s.offset.y *= k; s.offset.z *= k;
  }
  return s;
}
