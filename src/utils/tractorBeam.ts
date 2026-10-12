import { COSMIC_BOUNDS } from "../constants";
import { wrapDelta } from "./toroidal";
import type { Vec3 } from "./reactions";

/**
 * Tractor beam (spec §6). One rule: the lighter object moves. Crystals and
 * belt pebbles come to the ship; data shards are anchored, so the beam reels
 * the ship toward them. Pure and allocation-free; wrap-aware throughout.
 */
export const BEAM_MAX_TARGETS = 3;
export const BEAM_HALF_ANGLE = (20 * Math.PI) / 180;
const COS_HALF = Math.cos(BEAM_HALF_ANGLE);
export const BEAM_RANGE = 30;
export const PEBBLE_RANGE = 15;
export const CRYSTAL_PULL_SPEED = 20;
export const PEBBLE_PULL_SPEED = 8;
export const REEL_ACCEL = 15;

export type BeamKind = "crystal" | "shard" | "pebble";

/** Up to BEAM_MAX_TARGETS targets, nearest first. Parallel arrays: no allocation per frame. */
export interface BeamSelection {
  count: number;
  kind: BeamKind[]; index: number[]; ring: number[]; dist: number[];
  x: number[]; y: number[]; z: number[];
}

export function createSelection(): BeamSelection {
  const n = BEAM_MAX_TARGETS;
  return {
    count: 0, kind: Array<BeamKind>(n).fill("crystal"), index: Array(n).fill(-1), ring: Array(n).fill(-1),
    dist: Array(n).fill(Infinity), x: Array(n).fill(0), y: Array(n).fill(0), z: Array(n).fill(0),
  };
}

export function clearSelection(sel: BeamSelection): void { sel.count = 0; }

/**
 * Distance from the nose origin to the target if it lies inside the beam cone
 * (half-angle BEAM_HALF_ANGLE about the unit direction d) and within `range`;
 * -1 otherwise. Uses the shortest delta across the wrap seam.
 */
export function inCone(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  tx: number, ty: number, tz: number, range: number,
): number {
  const rx = wrapDelta(ox, tx, COSMIC_BOUNDS), ry = wrapDelta(oy, ty, COSMIC_BOUNDS), rz = wrapDelta(oz, tz, COSMIC_BOUNDS);
  const dist = Math.hypot(rx, ry, rz);
  if (dist > range) return -1;
  if (dist < 1e-6) return 0;
  return (rx * dx + ry * dy + rz * dz) / dist >= COS_HALF ? dist : -1;
}

/** Nearest-first insertion; keeps at most `max` (≤ BEAM_MAX_TARGETS). */
export function consider(
  sel: BeamSelection, max: number, kind: BeamKind, index: number, ring: number,
  dist: number, x: number, y: number, z: number,
): void {
  if (max <= 0) return;
  let at = sel.count;
  while (at > 0 && sel.dist[at - 1] > dist) at--;
  if (at >= max) return;
  const last = Math.min(sel.count, max - 1);
  for (let i = last; i > at; i--) {
    sel.kind[i] = sel.kind[i - 1]; sel.index[i] = sel.index[i - 1]; sel.ring[i] = sel.ring[i - 1];
    sel.dist[i] = sel.dist[i - 1]; sel.x[i] = sel.x[i - 1]; sel.y[i] = sel.y[i - 1]; sel.z[i] = sel.z[i - 1];
  }
  sel.kind[at] = kind; sel.index[at] = index; sel.ring[at] = ring; sel.dist[at] = dist;
  sel.x[at] = x; sel.y[at] = y; sel.z[at] = z;
  sel.count = Math.min(max, sel.count + 1);
}

/**
 * Moves `p` toward the ship at `speed` RELATIVE to it (the ship's own motion
 * is added first, so a pull keeps up with a moving ship), never past it.
 * Returns the remaining distance. Wrap-aware.
 */
export function pullStep(p: Vec3, ship: Vec3, shipVel: Vec3, speed: number, dt: number): number {
  p.x += shipVel.x * dt; p.y += shipVel.y * dt; p.z += shipVel.z * dt;
  const dx = wrapDelta(p.x, ship.x, COSMIC_BOUNDS), dy = wrapDelta(p.y, ship.y, COSMIC_BOUNDS), dz = wrapDelta(p.z, ship.z, COSMIC_BOUNDS);
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return 0;
  const step = Math.min(d, speed * dt);
  p.x += (dx / d) * step; p.y += (dy / d) * step; p.z += (dz / d) * step;
  return d - step;
}

/** Reels the pilot's velocity toward a shard along the unit direction, capped at maxSpeed. */
export function reelStep(v: Vec3, dirX: number, dirY: number, dirZ: number, dt: number, maxSpeed: number): void {
  v.x += dirX * REEL_ACCEL * dt; v.y += dirY * REEL_ACCEL * dt; v.z += dirZ * REEL_ACCEL * dt;
  const l = Math.hypot(v.x, v.y, v.z);
  if (l > maxSpeed) { const s = maxSpeed / l; v.x *= s; v.y *= s; v.z *= s; }
}

/**
 * The shard the beam reels toward: the nearest uncollected one inside the cone
 * and range, or -1. Deliberately takes no target budget: reeling moves the
 * SHIP, it is not a pull, so tethered belt pebbles must never starve it (a
 * shard inside the belt otherwise lost its reel once 3 pebbles were tethered).
 */
export function nearestShardInCone(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  shards: readonly { pos: readonly [number, number, number] }[], collected: readonly number[],
): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < shards.length; i++) {
    if (collected.includes(i)) continue;
    const [x, y, z] = shards[i].pos;
    const d = inCone(ox, oy, oz, dx, dy, dz, x, y, z, BEAM_RANGE);
    if (d >= 0 && d < bestD) { bestD = d; best = i; }
  }
  return best;
}
