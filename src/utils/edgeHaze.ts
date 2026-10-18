import { SYSTEM_RADIUS } from "../constants";
import type { Vec3 } from "./reactions";

/**
 * The soft edge: a nebula haze thickens from HAZE_START to SYSTEM_RADIUS (radial),
 * and past the radius a return burn brakes the outward velocity and nudges the
 * ship back in. Nothing wraps; the edge is real.
 */
export const HAZE_START = SYSTEM_RADIUS - 40;
/** Return-burn authority (u/s^2): beats the pilot's 25.2 thrust. */
export const EDGE_BRAKE = 40;
/** The inward drift (u/s) the burn settles to outside the radius. */
export const EDGE_RETURN_SPEED = 10;
/** Overlay opacity at full depth: enough that deep space is a wall of nebula. */
export const HAZE_MAX_OPACITY = 0.92;
const LINE_AT = 0.3;
const REARM_BELOW = 0.1;

/** 0 inside HAZE_START, smoothstep to 1 at SYSTEM_RADIUS, holding at 1 beyond. */
export function edgeDepth(x: number, y: number, z: number): number {
  const m = Math.hypot(x, y, z);
  const u = Math.min(1, Math.max(0, (m - HAZE_START) / (SYSTEM_RADIUS - HAZE_START)));
  return u * u * (3 - 2 * u);
}

/**
 * The return burn. Outside SYSTEM_RADIUS, each frame spends EDGE_BRAKE*dt: first
 * cancelling outward velocity, then pushing inward up to EDGE_RETURN_SPEED. Mutates `v`; returns true while active.
 */
export function edgeReturn(p: Vec3, v: Vec3, dt: number): boolean {
  const r = Math.hypot(p.x, p.y, p.z);
  if (r <= SYSTEM_RADIUS) return false;
  const nx = p.x / r, ny = p.y / r, nz = p.z / r;
  const vr = v.x * nx + v.y * ny + v.z * nz;
  const step = EDGE_BRAKE * dt;
  let dv = 0; // change along +n
  let left = step; // brake budget left after cancelling outward motion
  let vrNow = vr;
  if (vr > 0) { const c = Math.min(vr, step); dv = -c; left = step - c; vrNow = vr - c; }
  // Leftover budget pushes inward: without it a pilot thrusting outward would
  // sit pinned at v = 0 just past the radius (thrust 25.2 < brake 40, each frame
  // the brake only cancels that frame's thrust).
  if (left > 0 && -vrNow < EDGE_RETURN_SPEED) dv -= Math.min(left, EDGE_RETURN_SPEED + vrNow);
  v.x += dv * nx; v.y += dv * ny; v.z += dv * nz;
  return true;
}

/**
 * The edge cut latch. Set once the ship is past SYSTEM_RADIUS; while set, warp
 * is refused, so the burn bringing the ship back to the edge cannot re-engage warp
 * (which would point outward again and bounce). Cleared when boost is released
 * or the ship is back inside HAZE_START.
 */
export function edgeLatch(latched: boolean, r: number, boost: boolean): boolean {
  if (r > SYSTEM_RADIUS) return true;
  if (!boost || r < HAZE_START) return false;
  return latched;
}

const BURN_LINE_COOLDOWN_S = 20;

/** The return-burn radio line: at most once per 20 s while the burn is active, held while the radio is busy. */
export class ReturnBurnLineGate {
  private last = -Infinity;
  update(active: boolean, now: number, radioBusy: boolean): boolean {
    if (!active || radioBusy || now - this.last < BURN_LINE_COOLDOWN_S) return false;
    this.last = now;
    return true;
  }
}

/**
 * One haze radio line per visit: fires the first time depth passes LINE_AT
 * while the radio is free and no race runs (held, not dropped, while it
 * isn't), and re-arms once the pilot is back below REARM_BELOW.
 */
export class HazeLineGate {
  private armed = true;
  update(depth: number, radioBusy: boolean, raceRunning: boolean): boolean {
    if (depth < REARM_BELOW) { this.armed = true; return false; }
    if (!this.armed || depth < LINE_AT || radioBusy || raceRunning) return false;
    this.armed = false;
    return true;
  }
}

/**
 * Radio-busy bookkeeping for the edge lines. The haze line (depth 0.3, ~r 455)
 * must not block the return-burn line a second later, so the burn asks for
 * busyness ignoring edge lines; every other broadcast still blocks it.
 */
export class EdgeRadioClock {
  private id = 0;
  private lastAny = -Infinity;
  private lastOther = -Infinity;
  /** Call every frame with the current broadcast id; `isEdgeLine` says whether a newly seen broadcast is a haze/burn line. */
  observe(id: number, now: number, isEdgeLine: () => boolean): void {
    if (id === this.id) return;
    this.id = id;
    this.lastAny = now;
    if (!isEdgeLine()) this.lastOther = now;
  }
  busy(now: number, windowS: number): boolean { return now - this.lastAny < windowS; }
  busyIgnoringEdge(now: number, windowS: number): boolean { return now - this.lastOther < windowS; }
}
