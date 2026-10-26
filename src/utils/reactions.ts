/**
 * Shared, pure building blocks for the world reacting to the player's ship
 * (docs/archive/specs/2026-10-12-world-reactions-design.md). Every
 * reaction is an eased offset on top of existing motion; these helpers do the
 * easing and the geometry. No three.js scene access, so all of it unit-tests.
 */

export interface Vec3 { x: number; y: number; z: number }

/** 1 at or inside `inner`, 0 at or beyond `outer`, smoothstep between. */
export function proximity(d: number, inner: number, outer: number): number {
  if (d <= inner) return 1;
  if (d >= outer) return 0;
  const t = (outer - d) / (outer - inner);
  return t * t * (3 - 2 * t);
}

/**
 * The factor that closes half the remaining gap every `halfLife` seconds.
 * Computed once per frame when many values share one half-life (the belt).
 */
export function decay(halfLife: number, dt: number): number {
  return halfLife <= 0 ? 0 : Math.pow(0.5, dt / halfLife);
}

/**
 * Frame-rate-independent exponential approach: the same idiom as
 * CargoTraffic's `1 - Math.pow(0.01, dt)`, expressed as a half-life so the
 * spec's "eases in ~1s" maps to a number. Never overshoots, whatever `dt`.
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  return target + (current - target) * decay(halfLife, dt);
}

/** `damp` on each axis, in place. */
export function dampVec(current: Vec3, target: Vec3, halfLife: number, dt: number): void {
  const k = decay(halfLife, dt);
  current.x = target.x + (current.x - target.x) * k;
  current.y = target.y + (current.y - target.y) * k;
  current.z = target.z + (current.z - target.z) * k;
}

/**
 * Unit vector from `from` toward `to`, written into `out`. Coincident points
 * give straight up rather than NaN, so a player sitting exactly on a body
 * still gets a defined reaction.
 */
export function awayFrom(out: Vec3, from: Vec3, to: Vec3): Vec3 {
  const x = to.x - from.x, y = to.y - from.y, z = to.z - from.z;
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) { out.x = 0; out.y = 1; out.z = 0; return out; }
  out.x = x / len; out.y = y / len; out.z = z / len;
  return out;
}
