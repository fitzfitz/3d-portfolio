import { COSMIC_BOUNDS } from "../constants";
import { wrapDelta } from "./toroidal";
import type { Vec3 } from "./reactions";

/**
 * Gravity wells (docs/superpowers/specs/2026-10-12-flight-feel-design.md §5).
 *
 * The ship's flight model is heavily damped (thrust 25.2 u/s², drag ~1.09/s),
 * so gravity added to the pilot's velocity is erased: a tuning run measured
 * 0.3° of bend and no exit boost. Gravity therefore builds its own momentum
 * `G`, which decays slowly; the ship moves by (pilot velocity + G).
 *
 * Three deliberate departures from real physics, all listed in the spec:
 * the separate momentum layer, the lenient climb-out (CLIMB_OUT) and the fling
 * (G swings to the direction of travel while outbound). Constants come from
 * the 2026-10-12 tuning run; the targets they meet are tests/gravityWell.test.ts.
 */
export interface Well { x: number; y: number; z: number; g: number; radius: number; rMin: number }

export const PLANET_WELL_G = 3000;
/** Planet well radius = size × this (56u at size 16). */
export const PLANET_WELL_RADIUS_FACTOR = 3.5;
export const SUN_WELL_G = 1000;
/** Stops short of the inner planet orbit (115). */
export const SUN_WELL_RADIUS = 110;
export const G_HALF_LIFE = 3;
export const G_HALF_LIFE_KEEPING = 0.4;
export const G_HALF_LIFE_WARP = 0.2;
export const CLIMB_OUT = 0.4;
export const FLING_HALF_LIFE = 0.25;
export const G_MAX = 14;
/** Total speed ceiling outside warp. 24 × 0.05s = 1.2u per step, far under race MAX_STEP. */
export const SPEED_CEILING = 24;
/** No thrust for this long and the ship keeps station: no pull. */
export const STATION_KEEP_AFTER = 0.6;
/** Leaving a planet well faster than this is a slingshot (sound and radio). */
export const SLINGSHOT_SPEED = 14;
export const SLINGSHOT_COOLDOWN_S = 30;
/** Pull fades from full at this share of the radius to zero at the edge. */
const FADE_FROM = 0.8;

export type GravityMode = "off" | "free" | "keeping" | "warp";

/** Which safeguard applies this frame (spec §5.2). */
export function gravityMode(hasFlown: boolean, warp: boolean, idleFor: number): GravityMode {
  if (!hasFlown) return "off";
  if (warp) return "warp";
  return idleFor >= STATION_KEEP_AFTER ? "keeping" : "free";
}

/** Pull magnitude at distance `r` from a well's centre. */
export function wellAccel(r: number, w: Well): number {
  if (r >= w.radius) return 0;
  const rr = Math.max(r, w.rMin);
  const u = Math.min(1, Math.max(0, (r - FADE_FROM * w.radius) / ((1 - FADE_FROM) * w.radius)));
  return (w.g / (rr * rr)) * (1 - u * u * (3 - 2 * u));
}

/**
 * Advances gravity momentum `G` by one frame and returns it. `pos` is the
 * ship, `v` the pilot's velocity (read only), `wells[0..count)` the active
 * wells. Order matches the tuning run: decay, then per well the pull (scaled
 * by CLIMB_OUT outbound) and the outbound fling, then the caps.
 */
export function stepGravity(G: Vec3, pos: Vec3, v: Vec3, wells: readonly Well[], count: number, mode: GravityMode, dt: number): Vec3 {
  if (mode === "off") { G.x = 0; G.y = 0; G.z = 0; return G; }
  const hl = mode === "free" ? G_HALF_LIFE : mode === "keeping" ? G_HALF_LIFE_KEEPING : G_HALF_LIFE_WARP;
  const k = Math.pow(0.5, dt / hl);
  G.x *= k; G.y *= k; G.z *= k;

  if (mode === "free") {
    // Direction of travel, measured once before this frame's pull.
    const tx = v.x + G.x, ty = v.y + G.y, tz = v.z + G.z;
    const ts = Math.hypot(tx, ty, tz) || 1;
    const kFling = 1 - Math.pow(0.5, dt / FLING_HALF_LIFE);
    for (let i = 0; i < count; i++) {
      const w = wells[i];
      const dx = wrapDelta(pos.x, w.x, COSMIC_BOUNDS);
      const dy = wrapDelta(pos.y, w.y, COSMIC_BOUNDS);
      const dz = wrapDelta(pos.z, w.z, COSMIC_BOUNDS);
      const r = Math.hypot(dx, dy, dz);
      if (r >= w.radius || r < 1e-6) continue;
      const ux = dx / r, uy = dy / r, uz = dz / r;
      let a = wellAccel(r, w);
      if (tx * ux + ty * uy + tz * uz < 0) {
        // Outbound: lenient climb-out, and G swings toward the direction of
        // travel, keeping its length (the fling).
        a *= CLIMB_OUT;
        const gl = Math.hypot(G.x, G.y, G.z);
        if (gl > 1e-6) {
          const nx = G.x + ((tx / ts) * gl - G.x) * kFling;
          const ny = G.y + ((ty / ts) * gl - G.y) * kFling;
          const nz = G.z + ((tz / ts) * gl - G.z) * kFling;
          const nl = Math.hypot(nx, ny, nz) || 1;
          G.x = (nx / nl) * gl; G.y = (ny / nl) * gl; G.z = (nz / nl) * gl;
        }
      }
      G.x += ux * a * dt; G.y += uy * a * dt; G.z += uz * a * dt;
    }
  }

  const gl = Math.hypot(G.x, G.y, G.z);
  if (gl > G_MAX) { const s = G_MAX / gl; G.x *= s; G.y *= s; G.z *= s; }
  const sx = v.x + G.x, sy = v.y + G.y, sz = v.z + G.z;
  const sl = Math.hypot(sx, sy, sz);
  if (sl > SPEED_CEILING) {
    const s = SPEED_CEILING / sl;
    G.x = sx * s - v.x; G.y = sy * s - v.y; G.z = sz * s - v.z;
  }
  return G;
}

/**
 * After breaking orbit, the escape push leaves the ship inside the planet's
 * well; pulling it straight back would relock it. The planet just left is
 * skipped until the ship is outside that planet's well.
 */
export class EscapeGrace {
  private name: string | null = null;
  arm(name: string): void { this.name = name; }
  get skip(): string | null { return this.name; }
  update(distToBody: number, wellRadius: number): void { if (this.name && distToBody >= wellRadius) this.name = null; }
  clear(): void { this.name = null; }
}

/**
 * Radio line for a slingshot: on a fast well exit, at most once per
 * SLINGSHOT_COOLDOWN_S, never over a busy radio or during a race. A
 * suppressed exit is spent, not deferred, like cargo hails (HailGate).
 */
export class SlingshotGate {
  private lastAt = -Infinity;
  update(exitedFast: boolean, now: number, radioBusy: boolean, raceRunning: boolean): boolean {
    if (!exitedFast || radioBusy || raceRunning || now - this.lastAt < SLINGSHOT_COOLDOWN_S) return false;
    this.lastAt = now;
    return true;
  }
}
