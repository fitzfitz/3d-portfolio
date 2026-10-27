/**
 * Motion shared by the saucer and tardigrade AIs: steering, the leash, the
 * facing slew, the flinch timer and the defeat/leave fade. Allocation-free;
 * every function mutates the monster it is given.
 */
import { LEAVE_S, NEST_LEASH_R } from "./constants";
import type { AimTarget, V3 } from "./types";

/** The fields both monsters share. `fx, fy, fz` is the unit facing (world). */
export interface MonsterBody extends AimTarget {
  phaseT: number; hp: number; hitT: number;
  fx: number; fy: number; fz: number;
  scale: number;
}

/** Float slack for timer comparisons, so 120 steps of 1/120 s count as 1 s. */
export const T_EPS = 1e-9;

/** A uniform roll in [lo, hi]. */
export function roll(range: readonly [number, number], rnd: () => number): number {
  return range[0] + (range[1] - range[0]) * rnd();
}

/**
 * Turns the velocity toward the desired one by at most `accel · dt`, then
 * caps the speed at `maxSpeed`.
 */
export function steer(
  m: MonsterBody, dvx: number, dvy: number, dvz: number, maxSpeed: number, accel: number, dt: number,
): void {
  let ex = dvx - m.vx, ey = dvy - m.vy, ez = dvz - m.vz;
  const el = Math.hypot(ex, ey, ez);
  const maxDv = accel * dt;
  if (el > maxDv) { const k = maxDv / el; ex *= k; ey *= k; ez *= k; }
  m.vx += ex; m.vy += ey; m.vz += ez;
  capSpeed(m, maxSpeed);
}

function capSpeed(m: MonsterBody, maxSpeed: number): void {
  const sp = Math.hypot(m.vx, m.vy, m.vz);
  if (sp > maxSpeed) { const k = maxSpeed / sp; m.vx *= k; m.vy *= k; m.vz *= k; }
}

/** With the ship out, monsters head for the centre and settle this close. */
export const HOME_R = 25;
/** Pull toward the home radius (1/s). */
const HOME_GAIN = 1.2;

/**
 * The ship is out: steer toward `centre` at up to `maxSpeed`, slowing to a
 * stop at `HOME_R` from it (they stop firing and drift back).
 */
export function driftHome(m: MonsterBody, centre: V3, maxSpeed: number, accel: number, dt: number): void {
  const dx = centre.x - m.x, dy = centre.y - m.y, dz = centre.z - m.z;
  const d = Math.hypot(dx, dy, dz);
  const want = d > HOME_R ? Math.min(maxSpeed, (d - HOME_R) * HOME_GAIN) / d : 0;
  steer(m, dx * want, dy * want, dz * want, maxSpeed, accel, dt);
}

/**
 * Moves by the velocity, then clamps the position to the leash round
 * `centre`. A clamped monster loses its outward velocity (it slides along
 * the edge instead of pushing on it).
 */
export function moveLeashed(m: MonsterBody, dt: number, centre: V3): void {
  m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
  const rx = m.x - centre.x, ry = m.y - centre.y, rz = m.z - centre.z;
  const d = Math.hypot(rx, ry, rz);
  if (d <= NEST_LEASH_R) return;
  const ux = rx / d, uy = ry / d, uz = rz / d;
  m.x = centre.x + ux * NEST_LEASH_R; m.y = centre.y + uy * NEST_LEASH_R; m.z = centre.z + uz * NEST_LEASH_R;
  const out = m.vx * ux + m.vy * uy + m.vz * uz;
  if (out > 0) { m.vx -= ux * out; m.vy -= uy * out; m.vz -= uz * out; }
}

/** Points the facing straight along (dx, dy, dz); a zero vector leaves it. */
export function faceToward(m: MonsterBody, dx: number, dy: number, dz: number): void {
  const l = Math.hypot(dx, dy, dz);
  if (l === 0) return;
  m.fx = dx / l; m.fy = dy / l; m.fz = dz / l;
}

/**
 * Turns the unit facing toward (dx, dy, dz) by at most `maxRad`, in the
 * plane the two span (about world Y first if they are opposite).
 */
export function slewFacing(m: MonsterBody, dx: number, dy: number, dz: number, maxRad: number): void {
  const l = Math.hypot(dx, dy, dz);
  if (l === 0) return;
  const tx = dx / l, ty = dy / l, tz = dz / l;
  const fx = m.fx, fy = m.fy, fz = m.fz;
  const c = fx * tx + fy * ty + fz * tz;
  if (c >= Math.cos(maxRad)) { m.fx = tx; m.fy = ty; m.fz = tz; return; }
  // The unit direction from f toward t, perpendicular to f.
  let px = tx - fx * c, py = ty - fy * c, pz = tz - fz * c;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-9) {
    // Opposite: turn about world Y (perp = Y × f), or about X when f is vertical.
    px = fz; py = 0; pz = -fx;
    pl = Math.hypot(px, pz);
    if (pl < 1e-9) { px = 0; py = -fz; pz = fy; pl = Math.hypot(py, pz); }
  }
  const cs = Math.cos(maxRad), sn = Math.sin(maxRad) / pl;
  const nx = fx * cs + px * sn, ny = fy * cs + py * sn, nz = fz * cs + pz * sn;
  const nl = Math.hypot(nx, ny, nz);
  m.fx = nx / nl; m.fy = ny / nl; m.fz = nz / nl;
}

/** Counts the flinch down; returns the hit pose, 1 at the hit → 0 after `poseS`. */
export function flinch(m: MonsterBody, dt: number, poseS: number): number {
  m.hitT = Math.max(0, m.hitT - dt);
  return m.hitT / poseS;
}

/**
 * A bolt hit on a live monster: the flinch (`hitT = poseS`, `pose.hit = 1`)
 * and one hit point. True on the defeating hit, which also starts the fade.
 * A dying or gone monster takes none (false).
 */
export function takeHit(m: MonsterBody, pose: { hit: number }, poseS: number): boolean {
  if (!m.alive) return false;
  m.hitT = poseS;
  pose.hit = 1;
  m.hp--;
  if (m.hp > 0) return false;
  startFade(m);
  return true;
}

/** Starts a defeat or a leave: no longer a target, the fade's clock at 0. */
export function startFade(m: MonsterBody): void {
  m.alive = false;
  m.phaseT = 0;
}

/**
 * One step of a defeat or a leave (`phaseT` already advanced): drift away
 * from the ship at `drift` u/s (0 holds still), stay on the leash, hold full
 * size for `holdS`, then shrink 1 → 0 over `LEAVE_S`. True once it is gone.
 */
export function stepFade(m: MonsterBody, ship: V3, centre: V3, dt: number, holdS: number, drift: number): boolean {
  if (drift > 0) {
    let ax = m.x - ship.x, ay = m.y - ship.y, az = m.z - ship.z;
    let al = Math.hypot(ax, ay, az);
    if (al === 0) { ax = -m.fx; ay = -m.fy; az = -m.fz; al = 1; }
    const k = drift / al;
    m.vx = ax * k; m.vy = ay * k; m.vz = az * k;
  } else {
    m.vx = 0; m.vy = 0; m.vz = 0;
  }
  moveLeashed(m, dt, centre);
  const s = (m.phaseT - holdS) / LEAVE_S;
  if (s >= 1 - T_EPS) {
    m.scale = 0;
    m.vx = 0; m.vy = 0; m.vz = 0;
    return true;
  }
  // Never grows: a sleeper sent away before it had grown in shrinks from its own size.
  m.scale = Math.min(m.scale, s <= 0 ? 1 : 1 - s);
  return false;
}
