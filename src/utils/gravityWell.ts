import type { Vec3 } from "./reactions";
import { RADIO_BUSY_S } from "./cargoReaction";

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
      const dx = (w.x - pos.x);
      const dy = (w.y - pos.y);
      const dz = (w.z - pos.z);
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
  // The ceiling limits what gravity ADDS; it never touches the pilot's own
  // speed (warp is 39). Shorten G by the largest λ in [0, 1] with
  // |v + λG| ≤ SPEED_CEILING; λ = 0 once the pilot alone is at the ceiling.
  // Rescaling the total instead turned G into a ~14 u/s backwards vector in
  // warp, so releasing Shift flew the ship backwards.
  if (mode !== "warp") {
    const sx = v.x + G.x, sy = v.y + G.y, sz = v.z + G.z;
    if (Math.hypot(sx, sy, sz) > SPEED_CEILING) {
      const vv = v.x * v.x + v.y * v.y + v.z * v.z;
      const vg = v.x * G.x + v.y * G.y + v.z * G.z;
      const gg = G.x * G.x + G.y * G.y + G.z * G.z;
      const c2 = SPEED_CEILING * SPEED_CEILING;
      let lambda = 0;
      if (vv < c2 && gg > 1e-12) {
        lambda = (-vg + Math.sqrt(Math.max(0, vg * vg - gg * (vv - c2)))) / gg;
        lambda = Math.min(1, Math.max(0, lambda));
      }
      G.x *= lambda; G.y *= lambda; G.z *= lambda;
    }
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

/** Gravity momentum at a well exit below this was not a slingshot (e.g. warp, a cruise past the rim). */
export const ASSIST_MIN_G = 2;

/**
 * Decides, every free-flight frame, whether leaving a planet's well was a
 * slingshot: the whoosh plays on a fast exit that gravity helped (not warp),
 * and the radio line goes through SlingshotGate. The radio's last-change time
 * is tracked every frame; sampling it only at exits stamped stale broadcasts
 * as fresh and dropped most callouts.
 */
export class SlingshotWatch {
  private gate = new SlingshotGate();
  private inWell: string | null = null;
  private lastId = 0;
  private lastAt = -Infinity;

  update(
    now: number, broadcastId: number, wellNow: string | null, speed: number, gMag: number,
    warp: boolean, raceRunning: boolean, out: { whoosh: boolean; line: boolean },
  ): { whoosh: boolean; line: boolean } {
    out.whoosh = false; out.line = false;
    if (broadcastId !== this.lastId) { this.lastId = broadcastId; this.lastAt = now; }
    const exited = this.inWell !== null && wellNow !== this.inWell;
    this.inWell = wellNow;
    if (!exited) return out;
    const assisted = !warp && speed > SLINGSHOT_SPEED && gMag > ASSIST_MIN_G;
    out.whoosh = assisted;
    out.line = this.gate.update(assisted, now, now - this.lastAt < RADIO_BUSY_S, raceRunning);
    return out;
  }
}
