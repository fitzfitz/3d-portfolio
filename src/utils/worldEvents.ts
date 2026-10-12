import type { Vec3 } from "./reactions";
import { EVENT_DURATION } from "./eventDirector";

/**
 * Pure geometry for the world events (docs/superpowers/specs/2026-10-12-world-events-design.md).
 * Components read these with the event's elapsed time; nothing here touches the scene.
 */

/** Flare brightness 0..1 over `duration` seconds: two swells peaking at D/4 and 3D/4 (6s apart). */
export function flareEnvelope(t: number, duration = 12): number {
  if (t <= 0 || t >= duration) return 0;
  return 0.5 - 0.5 * Math.cos((4 * Math.PI * t) / duration);
}

/** Flare level for an elapsed time from worldEventElapsed("flare"); 0 when none is running. */
export function flareLevel(elapsed: number | null): number {
  return elapsed === null ? 0 : flareEnvelope(elapsed);
}

export interface Sphere extends Vec3 { r: number }

/** A straight comet pass: position = start + dir * speed * t. */
export interface CometPass { sx: number; sy: number; sz: number; dx: number; dy: number; dz: number; speed: number }

export const COMET_PASS_DIST = 35;
export const COMET_ENTRY_DIST = 250;
export const COMET_SPEED = 22;
export const COMET_TRIES = 8;

function randomUnit(random: () => number, out: Vec3): Vec3 {
  const z = 2 * random() - 1;
  const phi = 2 * Math.PI * random();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  out.x = r * Math.cos(phi); out.y = r * Math.sin(phi); out.z = z;
  return out;
}

/** A unit vector perpendicular to unit `d`, rotated by a random angle around it. */
function randomPerpendicular(d: Vec3, random: () => number, out: Vec3): Vec3 {
  // Any axis not parallel to d, then Gram-Schmidt.
  const ax = Math.abs(d.x) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
  const k = ax * d.x + ay * d.y;
  let px = ax - d.x * k, py = ay - d.y * k, pz = -d.z * k;
  const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
  const qx = d.y * pz - d.z * py, qy = d.z * px - d.x * pz, qz = d.x * py - d.y * px; // d × p
  const a = 2 * Math.PI * random();
  const c = Math.cos(a), s = Math.sin(a);
  out.x = px * c + qx * s; out.y = py * c + qy * s; out.z = pz * c + qz * s;
  return out;
}

/** Whether the segment start + d*[0,length] stays outside every sphere. */
function segmentClear(sx: number, sy: number, sz: number, d: Vec3, length: number, avoid: readonly Sphere[]): boolean {
  for (const a of avoid) {
    const cx = a.x - sx, cy = a.y - sy, cz = a.z - sz;
    const t = Math.min(length, Math.max(0, cx * d.x + cy * d.y + cz * d.z));
    if (Math.hypot(cx - d.x * t, cy - d.y * t, cz - d.z * t) <= a.r) return false;
  }
  return true;
}

/**
 * A pass whose closest approach to `target` is COMET_PASS_DIST, entering
 * COMET_ENTRY_DIST before that point, clear of every `avoid` sphere along its
 * whole length. Null after COMET_TRIES random directions all hit something.
 */
export function planCometPass(target: Vec3, avoid: readonly Sphere[], random: () => number): CometPass | null {
  const d = { x: 0, y: 0, z: 0 }, n = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < COMET_TRIES; i++) {
    randomUnit(random, d);
    randomPerpendicular(d, random, n);
    const cx = target.x + n.x * COMET_PASS_DIST, cy = target.y + n.y * COMET_PASS_DIST, cz = target.z + n.z * COMET_PASS_DIST;
    const sx = cx - d.x * COMET_ENTRY_DIST, sy = cy - d.y * COMET_ENTRY_DIST, sz = cz - d.z * COMET_ENTRY_DIST;
    // The whole flight (speed x event duration), not just 2x the entry distance.
    if (segmentClear(sx, sy, sz, d, COMET_SPEED * EVENT_DURATION.comet, avoid)) {
      return { sx, sy, sz, dx: d.x, dy: d.y, dz: d.z, speed: COMET_SPEED };
    }
  }
  return null;
}

export function cometPassAt(out: Vec3, p: CometPass, t: number): Vec3 {
  out.x = p.sx + p.dx * p.speed * t; out.y = p.sy + p.dy * p.speed * t; out.z = p.sz + p.dz * p.speed * t;
  return out;
}

/** Convoy frame: u away from the sun through the planet, v the orbit-entry side, w = u × v. */
export interface ConvoyPlan { ux: number; uy: number; uz: number; vx: number; vy: number; vz: number; wx: number; wy: number; wz: number; R: number }

export const CONVOY_ORBIT_FACTOR = 2.2;
export const CONVOY_APPROACH_S = 20;
export const CONVOY_ORBIT_S = 15;
export const CONVOY_HIDE_DIST = 250;
export const CONVOY_SPACING = 6;
/**
 * Orbit angular speed, matched to the approach: the Bezier arrives at speed
 * 3|P3 - P2| / T = 6R / T, so ω = 6 / T keeps the speed continuous at orbit
 * insertion (R·ω = 6R / T) instead of lurching ~75% faster (~0.7 turns in 15s).
 */
const CONVOY_OMEGA = 6 / CONVOY_APPROACH_S;

/**
 * The lead ship's offset from the planet centre at `t` seconds. Approach
 * (0–20s): a cubic Bézier in from 200u out on the anti-sun side, arriving
 * tangent to the orbit. Orbit (20–35s): a circle of radius R. Depart (35s+):
 * accelerating along the exit tangent with a climb, past the hide distance.
 */
export function convoyOffsetAt(out: Vec3, p: ConvoyPlan, t: number): Vec3 {
  const R = p.R;
  if (t < CONVOY_APPROACH_S) {
    const s = Math.max(0, t) / CONVOY_APPROACH_S, m = 1 - s;
    const b0 = m * m * m, b1 = 3 * m * m * s, b2 = 3 * m * s * s, b3 = s * s * s;
    // P0 = 200u + 40w, P1 = 110u, P2 = 2R u + R v, P3 = R v
    const cu = b0 * 200 + b1 * 110 + b2 * 2 * R, cv = (b2 + b3) * R, cw = b0 * 40;
    out.x = p.ux * cu + p.vx * cv + p.wx * cw;
    out.y = p.uy * cu + p.vy * cv + p.wy * cw;
    out.z = p.uz * cu + p.vz * cv + p.wz * cw;
    return out;
  }
  const orbitT = Math.min(t - CONVOY_APPROACH_S, CONVOY_ORBIT_S);
  const th = CONVOY_OMEGA * orbitT;
  // Circle R(v cos θ − u sin θ): starts at R v heading −u, the Bézier's end tangent.
  const cv = R * Math.cos(th), cu = -R * Math.sin(th);
  out.x = p.vx * cv + p.ux * cu; out.y = p.vy * cv + p.uy * cu; out.z = p.vz * cv + p.uz * cu;
  const tau = t - CONVOY_APPROACH_S - CONVOY_ORBIT_S;
  if (tau <= 0) return out;
  // Exit tangent (−v sin θ − u cos θ), accelerating, plus a climb along w.
  const tv = -Math.sin(th), tu = -Math.cos(th);
  const along = R * CONVOY_OMEGA * tau + 12 * tau * tau, climb = 4 * tau * tau;
  out.x += (p.vx * tv + p.ux * tu) * along + p.wx * climb;
  out.y += (p.vy * tv + p.uy * tu) * along + p.wy * climb;
  out.z += (p.vz * tv + p.uz * tu) * along + p.wz * climb;
  return out;
}

const ahead = { x: 0, y: 0, z: 0 };

/** Ship `slot`'s offset: 0 is the lead; 1 and 2 sit behind it, left and right, in a V. */
export function convoyShipOffsetAt(out: Vec3, p: ConvoyPlan, t: number, slot: 0 | 1 | 2): Vec3 {
  convoyOffsetAt(out, p, t);
  if (slot === 0) return out;
  convoyOffsetAt(ahead, p, t + 0.05);
  let fx = ahead.x - out.x, fy = ahead.y - out.y, fz = ahead.z - out.z;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // side = forward × w (w is roughly "up" for the convoy's plane), normalised
  let sx = fy * p.wz - fz * p.wy, sy = fz * p.wx - fx * p.wz, sz = fx * p.wy - fy * p.wx;
  const sl = Math.hypot(sx, sy, sz);
  if (sl < 1e-6) { sx = p.vx; sy = p.vy; sz = p.vz; } else { sx /= sl; sy /= sl; sz /= sl; }
  const side = slot === 1 ? -1 : 1;
  out.x += -fx * CONVOY_SPACING + sx * CONVOY_SPACING * side;
  out.y += -fy * CONVOY_SPACING + sy * CONVOY_SPACING * side;
  out.z += -fz * CONVOY_SPACING + sz * CONVOY_SPACING * side;
  return out;
}

/**
 * A convoy frame for a planet at `planetPos` (sun at the origin), trying eight
 * orbit-entry angles until `isClear` accepts one. Null if none does.
 */
export function planConvoy(planetPos: Vec3, planetSize: number, isClear: (plan: ConvoyPlan) => boolean): ConvoyPlan | null {
  const ul = Math.hypot(planetPos.x, planetPos.y, planetPos.z) || 1;
  const ux = planetPos.x / ul, uy = planetPos.y / ul, uz = planetPos.z / ul;
  // Base perpendicular: u × up, falling back to a z-x choice for a polar planet.
  let ax = -uz, ay = 0, az = ux;
  if (Math.hypot(ax, ay, az) < 1e-6) { ax = 0; ay = uz; az = -uy; }
  const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
  const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax; // u × a
  for (let k = 0; k < 8; k++) {
    const ang = (k * Math.PI) / 4, c = Math.cos(ang), s = Math.sin(ang);
    const vx = ax * c + bx * s, vy = ay * c + by * s, vz = az * c + bz * s;
    const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
    const plan = { ux, uy, uz, vx, vy, vz, wx, wy, wz, R: CONVOY_ORBIT_FACTOR * planetSize };
    if (isClear(plan)) return plan;
  }
  return null;
}
