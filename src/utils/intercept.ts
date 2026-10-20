import { PITCH_MAX } from "./pitchFlight";

interface Vec3 { x: number; y: number; z: number }

/** A moving target: its id and where it is at game time `t` (e.g. bodyPositionAt). */
export interface InterceptTarget {
  name: string;
  positionAt(t: number, out: Vec3): Vec3;
}
interface Sphere extends Vec3 { r: number }

export interface Aim {
  /** The target's name (a body id) being aimed at. */
  target: string;
  yaw: number;
  pitch: number;
  /** Seconds to arrival at cruise speed. */
  eta: number;
}

/** Spool-up from rest to cruise, roughly (ACCEL 25 u/s² against drag). */
const SPOOL_S = 0.3;
/** Clearance a path needs around each obstacle, on top of its radius. */
const CLEARANCE = 3;

/** Shortest distance from point c to the segment a→b. */
function segmentDistance(a: Vec3, b: Vec3, c: Vec3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1,
    ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / len2));
  return Math.hypot(a.x + abx * t - c.x, a.y + aby * t - c.y, a.z + abz * t - c.z);
}

/**
 * Heading that takes a ship flying straight at `speed` from `from` into a
 * body, leading it along its orbit. Inner bodies drift ~1–3 u/s, so aiming at
 * where one *is* misses by tens of units over a 10-second flight.
 *
 * Prefers the soonest arrival whose straight path clears every obstacle
 * (the sun sits near the line to some orbit positions); if none is clear,
 * falls back to the soonest overall. `lead` is false when orbits are frozen
 * (reduced motion), so the current position is the arrival position.
 */
export function interceptAim(
  from: Vec3,
  targets: readonly InterceptTarget[],
  now: number,
  speed: number,
  obstacles: Sphere[],
  lead = true,
): Aim | null {
  let best: Aim | null = null;
  let bestClear = false;
  for (const p of targets) {
    let eta = 0;
    let pos = p.positionAt(now, { x: 0, y: 0, z: 0 });
    // Fixed-point iteration on arrival time; converges in a few steps since
    // orbital speed is far below cruise speed.
    for (let i = 0; i < 4; i++) {
      eta = Math.hypot(pos.x - from.x, pos.y - from.y, pos.z - from.z) / speed + SPOOL_S;
      if (!lead) break;
      pos = p.positionAt(now + eta, pos);
    }
    const clear = obstacles.every((o) => segmentDistance(from, pos, o) > o.r + CLEARANCE);
    const better = !best || (clear && !bestClear) || (clear === bestClear && eta < best.eta);
    if (better) {
      const dx = pos.x - from.x, dy = pos.y - from.y, dz = pos.z - from.z;
      const pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.atan2(dy, Math.hypot(dx, dz))));
      best = { target: p.name, yaw: Math.atan2(dx, dz), pitch, eta };
      bestClear = clear;
    }
  }
  return best;
}
