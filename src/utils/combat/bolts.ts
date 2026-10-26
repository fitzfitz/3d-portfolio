/**
 * Plasma bolts: one fixed pool shared by the ship and the monsters, so the
 * combat loop never allocates. Each step keeps the previous position
 * (px, py, pz) so hits are tested on the swept segment, not the point: a 7 u
 * step (140 u/s at the 0.05 s dt clamp) must not tunnel through a 1.8 u saucer.
 */
import { BOLT_POOL } from "./constants";

export type BoltOwner = "ship" | "enemy";

export interface Bolt {
  live: boolean; owner: BoltOwner;
  x: number; y: number; z: number;
  /** Position before the last step. */
  px: number; py: number; pz: number;
  /** Unit direction. */
  dx: number; dy: number; dz: number;
  speed: number;
  /** Distance left to fly. */
  left: number;
  damage: number;
}

/** Fixed length: `fireBolt` reuses dead slots and never grows it. */
export interface BoltPool { bolts: Bolt[] }

export function createBoltPool(n: number = BOLT_POOL): BoltPool {
  const bolts: Bolt[] = [];
  for (let i = 0; i < n; i++) {
    bolts.push({
      live: false, owner: "ship", x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0,
      dx: 0, dy: 0, dz: 1, speed: 0, left: 0, damage: 0,
    });
  }
  return { bolts };
}

/** Launches a bolt from the first free slot; null when the pool is full. The direction is normalised. */
export function fireBolt(
  p: BoltPool, owner: BoltOwner, ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number, speed: number, range: number, damage: number,
): Bolt | null {
  const bolts = p.bolts;
  for (let i = 0; i < bolts.length; i++) {
    const b = bolts[i];
    if (b.live) continue;
    const l = Math.hypot(dx, dy, dz) || 1;
    b.live = true; b.owner = owner;
    b.x = b.px = ox; b.y = b.py = oy; b.z = b.pz = oz;
    b.dx = dx / l; b.dy = dy / l; b.dz = dz / l;
    b.speed = speed; b.left = range; b.damage = damage;
    return b;
  }
  return null;
}

/** Advances every live bolt by `dt`; a bolt dies once it has flown its range. */
export function stepBolts(p: BoltPool, dt: number): void {
  const bolts = p.bolts;
  for (let i = 0; i < bolts.length; i++) {
    const b = bolts[i];
    if (!b.live) continue;
    const step = b.speed * dt;
    b.px = b.x; b.py = b.y; b.pz = b.z;
    b.x += b.dx * step; b.y += b.dy * step; b.z += b.dz * step;
    b.left -= step;
    if (b.left <= 0) b.live = false;
  }
}

/** Kills every bolt, or only one owner's. */
export function clearBolts(p: BoltPool, owner?: BoltOwner): void {
  const bolts = p.bolts;
  for (let i = 0; i < bolts.length; i++) {
    if (owner === undefined || bolts[i].owner === owner) bolts[i].live = false;
  }
}

/** Whether the segment a→b comes within `r` of the centre c (closest point by clamped projection). */
export function segmentHitsSphere(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number, r: number,
): boolean {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 0 ? (acx * abx + acy * aby + acz * abz) / ab2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const qx = acx - abx * t, qy = acy - aby * t, qz = acz - abz * t;
  return qx * qx + qy * qy + qz * qz <= r * r;
}
