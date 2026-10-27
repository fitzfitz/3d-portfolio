/**
 * The Nest's effects, as pure maths the renderer (components/canvas/nest/
 * NestEffects.tsx) writes into its pooled buffers every frame: the plasma
 * jet's particles, the defeated saucers' smoke puffs, the hit sparks, and the
 * instance matrices of the bolts, the saucers' thrust glows and the sparks. Allocation-free:
 * pools are built once, every function writes into a caller's object.
 */
import type * as THREE from "three";
import { BOLT_R, JET_RANGE, MAX_SAUCERS, SAUCER_DEFEAT_S, SAUCER_SPEED } from "./constants";
import { monsterMatrix } from "./monsterFrame";
import type { Saucer } from "./saucerAi";
import type { V3 } from "./types";

/** Enemy bolts: green-yellow, to read as alien and differ from the ship's plume colour (spec). */
export const ENEMY_BOLT_HEX = "#c8ff3a";
/** The saucers' thrust glow. */
export const THRUST_HEX = "#9fe6ff";
/** The tardigrade's plasma jet. */
export const JET_HEX = "#8dff9a";
/**
 * The jet's particles: dense enough that neighbours overlap along its length
 * (90 u ÷ 720 = 0.125 u apart, against a 1 u sprite), so it reads as one stream.
 */
export const JET_PARTICLES = 720;
/** A jet particle's sprite size (u; size-attenuated Points). */
export const JET_SIZE = 1.0;
export const SMOKE_POOL = 96;

/** The jet's particles stream out of the mouth at this speed (u/s): the 90 u jet in 1.2 s. */
export const JET_STREAM_SPEED = JET_RANGE / 1.2;
/** The stream's slow twist about its axis (rad/s). */
const JET_SWIRL = 2.4;
/**
 * The stream's visible core: particles scatter up to this far from the axis
 * at the far end (well inside the 2.5 u hit radius, JET_RADIUS); narrower at
 * the mouth.
 */
export const JET_CORE_R = 0.6;
const JET_MOUTH_WIDTH = 0.35;
/** A particle's brightness varies by up to this either side of 1 (jetGlow). */
export const JET_GLOW_SPREAD = 0.45;

/** A defeated saucer puffs smoke this often while it drifts (SAUCER_DEFEAT_S). */
export const SMOKE_EVERY_S = 0.08;
/** A puff's life: it fades over it. */
export const SMOKE_LIFE_S = 1.4;
/** A puff's starting opacity. */
const SMOKE_ALPHA = 0.55;
/** Puffs start within this of the saucer and drift this slowly (u, u/s). */
const SMOKE_JITTER = 0.3;
const SMOKE_DRIFT = 0.6;

/** The thrust glow sits this far under the saucer's centre (model units, × its scale): its belly, round the cannon. */
export const THRUST_DROP = 0.95;
/** The glow's flattened size (model units) at full speed, and its share at rest. */
const THRUST_RADIUS = 0.9;
const THRUST_HEIGHT = 0.22;
const THRUST_IDLE = 0.25;

const fract = (x: number) => x - Math.floor(x);
/** A fixed pseudo-random 0..1 per particle index and salt (no allocation, no state). */
const hash01 = (i: number, salt: number) => fract(Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453);

/**
 * Particle i's brightness factor, 1 ± JET_GLOW_SPREAD, fixed per particle:
 * with the overlap it varies the stream's thickness and glow along its length.
 * (The shared PointsMaterial has one size, so brightness stands in for size.)
 */
export function jetGlow(i: number): number {
  return 1 + JET_GLOW_SPREAD * (2 * hash01(i, 0.53) - 1);
}

/**
 * Particle i of n at jet time t (s): on the axis from the mouth o along d
 * (any length), 0..JET_RANGE ahead of the mouth (evenly spaced, streaming
 * outward at JET_STREAM_SPEED and wrapping back to the mouth), scattered
 * within JET_CORE_R of the axis (a hashed radius and angle per particle,
 * twisting slowly), so the stream reads turbulent, not as a string of beads.
 * The hit test is the wider JET_RADIUS.
 */
export function jetParticle(i: number, n: number, t: number, ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number, out: V3): V3 {
  const l = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / l, uy = dy / l, uz = dz / l;
  // A side axis: world up × d (world X when d is vertical); then d × side.
  let sx = uz, sz = -ux;
  const sl = Math.hypot(sx, sz);
  if (sl < 1e-9) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; }
  const bx = uy * sz, by = uz * sx - ux * sz, bz = -uy * sx;
  const k = fract(i / n + (t * JET_STREAM_SPEED) / JET_RANGE);
  const along = k * JET_RANGE;
  const r = JET_CORE_R * Math.sqrt(hash01(i, 0.37)) * (JET_MOUTH_WIDTH + (1 - JET_MOUTH_WIDTH) * k);
  const a = hash01(i, 0.71) * Math.PI * 2 + t * JET_SWIRL;
  const c = Math.cos(a) * r, s = Math.sin(a) * r;
  out.x = ox + ux * along + sx * c + bx * s;
  out.y = oy + uy * along + by * s;
  out.z = oz + uz * along + sz * c + bz * s;
  return out;
}

// ── Smoke ──────────────────────────────────────────────────────────────────

export interface SmokePuff { live: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number }

/** A fixed ring of puffs (the next one written is the oldest) and each saucer slot's puff timer. */
export interface SmokePool { puffs: SmokePuff[]; next: number; emitIn: number[] }

export function createSmoke(n: number = SMOKE_POOL, emitters: number = MAX_SAUCERS): SmokePool {
  const puffs: SmokePuff[] = [];
  for (let i = 0; i < n; i++) puffs.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0 });
  return { puffs, next: 0, emitIn: new Array<number>(emitters).fill(0) };
}

/** A new puff near (x, y, z), in the oldest slot (puffs share one life, so the ring's next slot is the oldest). */
export function emitSmoke(p: SmokePool, x: number, y: number, z: number, rnd: () => number): SmokePuff {
  const f = p.puffs[p.next];
  p.next = (p.next + 1) % p.puffs.length;
  f.live = true; f.age = 0;
  f.x = x + (rnd() * 2 - 1) * SMOKE_JITTER;
  f.y = y + (rnd() * 2 - 1) * SMOKE_JITTER;
  f.z = z + (rnd() * 2 - 1) * SMOKE_JITTER;
  f.vx = (rnd() * 2 - 1) * SMOKE_DRIFT;
  f.vy = (rnd() * 2 - 1) * SMOKE_DRIFT;
  f.vz = (rnd() * 2 - 1) * SMOKE_DRIFT;
  return f;
}

/**
 * One step: puffs age, drift and expire; each saucer in its defeat drift
 * (phase "defeated", its first SAUCER_DEFEAT_S) puffs every SMOKE_EVERY_S,
 * so it trails smoke as it drifts off. dt 0 (a paused fight) changes
 * nothing. Returns the live puffs.
 */
export function stepSmoke(p: SmokePool, saucers: readonly Saucer[], dt: number, rnd: () => number): number {
  const puffs = p.puffs;
  let live = 0;
  if (!(dt > 0)) {
    for (let i = 0; i < puffs.length; i++) if (puffs[i].live) live++;
    return live;
  }
  for (let i = 0; i < puffs.length; i++) {
    const f = puffs[i];
    if (!f.live) continue;
    f.age += dt;
    if (f.age >= SMOKE_LIFE_S) { f.live = false; continue; }
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
  }
  for (let i = 0; i < saucers.length && i < p.emitIn.length; i++) {
    const s = saucers[i];
    if (s.phase !== "defeated" || s.phaseT > SAUCER_DEFEAT_S) { p.emitIn[i] = 0; continue; }
    p.emitIn[i] -= dt;
    while (p.emitIn[i] <= 0) {
      emitSmoke(p, s.x, s.y, s.z, rnd);
      p.emitIn[i] += SMOKE_EVERY_S;
    }
  }
  for (let i = 0; i < puffs.length; i++) if (puffs[i].live) live++;
  return live;
}

/** A puff's opacity at `age`: SMOKE_ALPHA fading to 0 at the end of its life. */
export function smokeAlpha(age: number): number {
  const k = 1 - age / SMOKE_LIFE_S;
  return k > 0 ? SMOKE_ALPHA * k * k : 0;
}

// ── Hit sparks (extra instances in the bolt mesh) ─────────────────────────

/** Sparks per ship-bolt hit… */
export const HIT_SPARKS = 4;
/** …from a fixed ring of this many (six strikes' worth; the oldest is reused). */
export const SPARK_POOL = 24;
/** A spark's life (s): it shrinks from SPARK_R to nothing over it. */
export const SPARK_LIFE_S = 0.3;
/** Sparks fly out from the hit point at this speed (u/s), each in a random direction. */
export const SPARK_SPEED = 6;
/** A spark's radius at birth (u). */
export const SPARK_R = 0.12;

export interface Spark { live: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number }

/** A fixed ring of sparks; `next` is the oldest slot (sparks share one life). */
export interface SparkPool { sparks: Spark[]; next: number }

export function createSparks(n: number = SPARK_POOL): SparkPool {
  const sparks: Spark[] = [];
  for (let i = 0; i < n; i++) sparks.push({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0 });
  return { sparks, next: 0 };
}

/**
 * A strike's burst: HIT_SPARKS sparks at (x, y, z) in the ring's oldest
 * slots, flying out at SPARK_SPEED in random directions (uniform over the
 * sphere); `still` (reduced motion): they burst and shrink but hold still.
 */
export function emitSparks(p: SparkPool, x: number, y: number, z: number, rnd: () => number, still: boolean): void {
  for (let i = 0; i < HIT_SPARKS; i++) {
    const s = p.sparks[p.next];
    p.next = (p.next + 1) % p.sparks.length;
    s.live = true; s.age = 0;
    s.x = x; s.y = y; s.z = z;
    const cz = 2 * rnd() - 1, a = 2 * Math.PI * rnd();
    const k = still ? 0 : SPARK_SPEED * Math.sqrt(1 - cz * cz);
    s.vx = k * Math.cos(a); s.vy = k * Math.sin(a); s.vz = still ? 0 : SPARK_SPEED * cz;
  }
}

/** One step: sparks age, fly and expire at SPARK_LIFE_S. dt 0 (a paused fight) changes nothing. Returns the live sparks. */
export function stepSparks(p: SparkPool, dt: number): number {
  const sparks = p.sparks;
  let live = 0;
  for (let i = 0; i < sparks.length; i++) {
    const s = sparks[i];
    if (!s.live) continue;
    if (dt > 0) {
      s.age += dt;
      if (s.age >= SPARK_LIFE_S) { s.live = false; continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    }
    live++;
  }
  return live;
}

/** A spark's instance: a sphere at its position, SPARK_R across at birth, shrinking linearly to nothing at SPARK_LIFE_S. */
export function sparkMatrix(s: Spark, out: THREE.Matrix4): THREE.Matrix4 {
  const k = SPARK_R * Math.max(0, 1 - s.age / SPARK_LIFE_S);
  return out.makeScale(k, k, k).setPosition(s.x, s.y, s.z);
}

// ── Near the camera ────────────────────────────────────────────────────────

/** Point sprites fade out from this far from the camera (u)… */
export const NEAR_FADE_FAR = 8;
/** …to nothing this close: a sprite sized by distance would otherwise fill the screen. */
export const NEAR_FADE_NEAR = 2;

/**
 * A point sprite's brightness (jet) or opacity (smoke) factor by its distance
 * from the camera: 1 from NEAR_FADE_FAR out, smoothstepping to 0 at
 * NEAR_FADE_NEAR and inside it. The jet and smoke Points are size-attenuated
 * (~560 px ÷ distance at 1280×800), so a particle passing the chase camera
 * would fill the screen; additive black and zero alpha draw nothing, and the
 * programs stay the shared ones.
 */
export function nearFade(px: number, py: number, pz: number, cam: V3): number {
  const d = Math.hypot(px - cam.x, py - cam.y, pz - cam.z);
  const x = (d - NEAR_FADE_NEAR) / (NEAR_FADE_FAR - NEAR_FADE_NEAR);
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
}

// Bolts near the camera (ruling N7). A fresh ship bolt is ~6 u from the
// chase camera, where a BOLT_GLOW_R sphere is a 60–90 px saturated disc for a
// frame or two (enemy bolts passing close the same). Render only: the hit
// tests keep the bolts' real radius.

/** A bolt's glow radius: its hit radius and a little haze. */
export const BOLT_GLOW_R = BOLT_R + 0.08;
/** The cross radius is at most this × the distance to the camera: ~16 px across at 1280×800 (60° fov). */
export const BOLT_NEAR_K = 0.012;
/** A bolt's colour fades from 1 at BOLT_FADE_FAR to 0 at BOLT_FADE_NEAR from the camera (u). */
export const BOLT_FADE_NEAR = 3;
export const BOLT_FADE_FAR = 12;

/** A bolt's drawn cross radius at `d` u from the camera: min(BOLT_GLOW_R, d × BOLT_NEAR_K). */
export function boltCrossRadius(d: number): number {
  return Math.min(BOLT_GLOW_R, d * BOLT_NEAR_K);
}

/** A bolt's colour factor at `d` u from the camera: 0 inside BOLT_FADE_NEAR, smoothstepping to 1 at BOLT_FADE_FAR. */
export function boltNearFade(d: number): number {
  const x = (d - BOLT_FADE_NEAR) / (BOLT_FADE_FAR - BOLT_FADE_NEAR);
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
}

// ── Bolts and thrust glows (one instanced mesh, a unit sphere) ────────────

/** A bolt's instance: a unit sphere stretched to `length` along its flight (dx, dy, dz), `radius` across, at (x, y, z). */
export function boltMatrix(x: number, y: number, z: number, dx: number, dy: number, dz: number,
  radius: number, length: number, out: THREE.Matrix4): THREE.Matrix4 {
  monsterMatrix(x, y, z, dx, dy, dz, 1, out);
  const e = out.elements;
  e[0] *= radius; e[1] *= radius; e[2] *= radius;
  e[4] *= radius; e[5] *= radius; e[6] *= radius;
  e[8] *= length; e[9] *= length; e[10] *= length;
  return out;
}

/**
 * A live saucer's thrust glow: a flattened sphere under its belly
 * (THRUST_DROP down its own up axis), growing from THRUST_IDLE of full size
 * at rest to full at SAUCER_SPEED, shrinking with the saucer.
 */
export function thrustMatrix(s: Saucer, out: THREE.Matrix4): THREE.Matrix4 {
  monsterMatrix(s.x, s.y, s.z, s.fx, s.fy, s.fz, 1, out);
  const e = out.elements;
  const k = s.scale;
  const sp = Math.min(1, Math.hypot(s.vx, s.vy, s.vz) / SAUCER_SPEED);
  const g = k * (THRUST_IDLE + (1 - THRUST_IDLE) * sp);
  // Down the saucer's up axis (column 1).
  e[12] -= e[4] * THRUST_DROP * k; e[13] -= e[5] * THRUST_DROP * k; e[14] -= e[6] * THRUST_DROP * k;
  const r = THRUST_RADIUS * g, h = THRUST_HEIGHT * g;
  e[0] *= r; e[1] *= r; e[2] *= r;
  e[4] *= h; e[5] *= h; e[6] *= h;
  e[8] *= r; e[9] *= r; e[10] *= r;
  return out;
}
