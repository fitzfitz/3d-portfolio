/**
 * Aiming, allocation-free: every function writes into `out` (which may be one
 * of its inputs) and returns it or an index.
 */
import { BOLT_RANGE, CLICK_AIM_DEPTH, CLICK_ASSIST_RAD, LOCK_ACQUIRE_RAD, LOCK_HOLD_RAD } from "./constants";
import type { AimTarget, V3 } from "./types";

const COS_ACQUIRE = Math.cos(LOCK_ACQUIRE_RAD);
const COS_HOLD = Math.cos(LOCK_HOLD_RAD);
const COS_CLICK = Math.cos(CLICK_ASSIST_RAD);

function setUnit(out: V3, x: number, y: number, z: number): V3 {
  const l = Math.hypot(x, y, z) || 1;
  out.x = x / l; out.y = y / l; out.z = z / l;
  return out;
}

/** The cosine of the angle between `dir` (any length) and the line from `origin` to `t`; -2 when `t` sits on the origin. */
function cosTo(origin: V3, dir: V3, t: V3): number {
  const dx = t.x - origin.x, dy = t.y - origin.y, dz = t.z - origin.z;
  const d = Math.hypot(dx, dy, dz);
  const l = Math.hypot(dir.x, dir.y, dir.z);
  if (d === 0 || l === 0) return -2;
  return (dx * dir.x + dy * dir.y + dz * dir.z) / (d * l);
}

/**
 * Lock-on, acquiring (held fire only): the nearest live target within
 * `LOCK_ACQUIRE_RAD` of the nose and `BOLT_RANGE` of the origin. Its index in
 * `targets`, else -1. The caller leads it with `leadAim`.
 */
export function acquireLock(origin: V3, nose: V3, targets: readonly AimTarget[]): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.alive) continue;
    const d = Math.hypot(t.x - origin.x, t.y - origin.y, t.z - origin.z);
    if (d > BOLT_RANGE || d >= bestD) continue;
    if (cosTo(origin, nose, t) < COS_ACQUIRE) continue;
    best = i; bestD = d;
  }
  return best;
}

/** Lock-on, holding: the locked target is still alive and within `LOCK_HOLD_RAD` of the nose (fire held or not). */
export function lockHolds(origin: V3, nose: V3, t: AimTarget): boolean {
  return t.alive && cosTo(origin, nose, t) >= COS_HOLD;
}

/**
 * Click assist: the live target at the smallest angle from the click's
 * camera ray, within `CLICK_ASSIST_RAD` and ahead of the ray's origin. Its
 * index in `targets`, else -1 (the shot goes at the click point). Never a lock.
 */
export function clickAssist(rayOrigin: V3, rayDir: V3, targets: readonly AimTarget[]): number {
  let best = -1;
  let bestCos = COS_CLICK;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (!t.alive) continue;
    const c = cosTo(rayOrigin, rayDir, t);
    // c > 0: ahead of the origin (CLICK_ASSIST_RAD < 90°, so the cone test already implies it).
    if (c < bestCos || c <= 0) continue;
    if (c === bestCos && best >= 0) continue;
    best = i; bestCos = c;
  }
  return best;
}

/**
 * Unit direction for a bolt at `speed` from `from` to meet a target moving at
 * `targetVel`: the smallest positive t with |d + v t| = s t. Aims straight at
 * the target when there is no intercept.
 */
export function leadAim(from: V3, target: V3, targetVel: V3, speed: number, out: V3): V3 {
  const dx = target.x - from.x, dy = target.y - from.y, dz = target.z - from.z;
  const vx = targetVel.x, vy = targetVel.y, vz = targetVel.z;
  const a = vx * vx + vy * vy + vz * vz - speed * speed;
  const b = 2 * (dx * vx + dy * vy + dz * vz);
  const c = dx * dx + dy * dy + dz * dz;
  let t = -1;
  if (Math.abs(a) < 1e-9) {
    if (b < 0) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
      const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      t = lo > 0 ? lo : hi;
    }
  }
  if (!(t > 0)) return setUnit(out, dx, dy, dz);
  return setUnit(out, dx + vx * t, dy + vy * t, dz + vz * t);
}

/**
 * A random direction within `maxRad` of `dir` (unit): angle `maxRad·√rnd()`
 * (uniform over the cone's disc) about a random azimuth.
 */
export function spreadDir(dir: V3, maxRad: number, rnd: () => number, out: V3): V3 {
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const fx = dir.x / l, fy = dir.y / l, fz = dir.z / l;
  const theta = maxRad * Math.sqrt(rnd());
  const phi = 2 * Math.PI * rnd();
  // u = unit(f × helper), w = f × u: an orthonormal frame around f.
  const useX = Math.abs(fx) < 0.9;
  const hx = useX ? 1 : 0, hy = useX ? 0 : 1;
  let ux = -fz * hy, uy = fz * hx, uz = fx * hy - fy * hx;
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul; uy /= ul; uz /= ul;
  const wx = fy * uz - fz * uy, wy = fz * ux - fx * uz, wz = fx * uy - fy * ux;
  const ct = Math.cos(theta), st = Math.sin(theta), cp = Math.cos(phi), sp = Math.sin(phi);
  return setUnit(
    out,
    fx * ct + (ux * cp + wx * sp) * st,
    fy * ct + (uy * cp + wy * sp) * st,
    fz * ct + (uz * cp + wz * sp) * st,
  );
}

/**
 * A click's aim point: on the camera ray, `CLICK_AIM_DEPTH` past the ship's
 * distance from the camera (the click plane's hit sits at the ship's depth).
 */
export function clickAimPoint(rayOrigin: V3, rayDir: V3, ship: V3, out: V3): V3 {
  const ox = rayOrigin.x, oy = rayOrigin.y, oz = rayOrigin.z;
  const depth = Math.hypot(ship.x - ox, ship.y - oy, ship.z - oz) + CLICK_AIM_DEPTH;
  const l = Math.hypot(rayDir.x, rayDir.y, rayDir.z) || 1;
  const k = depth / l;
  const px = ox + rayDir.x * k, py = oy + rayDir.y * k, pz = oz + rayDir.z * k;
  out.x = px; out.y = py; out.z = pz;
  return out;
}
