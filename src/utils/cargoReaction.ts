import { proximity, type Vec3 } from "./reactions";

/** Cargo ships react inside this distance of the player (spec: ~30u). */
export const CARGO_REACT_RADIUS = 30;
/** Largest sideways slide off the route (spec: ~10u). */
export const CARGO_SWERVE_MAX = 10;
/** A ship hails when the player first comes this close (spec: ~20u). */
export const CARGO_HAIL_RADIUS = 20;
/** At most one hail across all ships per this many seconds. */
export const HAIL_COOLDOWN_S = 45;
/**
 * A broadcast this recent is still typing out or being read: a shard fact or
 * scan report is the payoff for an action, and a hail must not replace it.
 */
export const RADIO_BUSY_S = 6;

/** Full swerve inside this share of the react radius; it ramps off beyond. */
const FULL_SWERVE_AT = 0.4;

/**
 * The offset a cargo ship wants right now: sideways to its route (the part of
 * "away from the player" that is perpendicular to `tangent`), scaled by how
 * close the player is. A player dead ahead or behind on the route line has no
 * sideways component, so the ship then picks its horizontal right-hand side.
 * Writes and returns `out`. `tangent` must be unit length.
 */
export function cargoSwerveTarget(out: Vec3, routePos: Vec3, tangent: Vec3, player: Vec3): Vec3 {
  const dx = routePos.x - player.x, dy = routePos.y - player.y, dz = routePos.z - player.z;
  const p = proximity(Math.hypot(dx, dy, dz), CARGO_REACT_RADIUS * FULL_SWERVE_AT, CARGO_REACT_RADIUS);
  if (p === 0) { out.x = 0; out.y = 0; out.z = 0; return out; }
  const along = dx * tangent.x + dy * tangent.y + dz * tangent.z;
  let sx = dx - along * tangent.x, sy = dy - along * tangent.y, sz = dz - along * tangent.z;
  let len = Math.hypot(sx, sy, sz);
  if (len < 1e-6) {
    sx = tangent.z; sy = 0; sz = -tangent.x;
    len = Math.hypot(sx, sz);
    if (len < 1e-6) { sx = 1; sz = 0; len = 1; } // vertical route: any horizontal side
  }
  const k = (CARGO_SWERVE_MAX * p) / len;
  out.x = sx * k; out.y = sy * k; out.z = sz * k;
  return out;
}

/**
 * Decides when a cargo ship hails: once per approach (re-armed only after the
 * player has left the react radius), at most once per HAIL_COOLDOWN_S across
 * every ship, never during a running time-trial lap, and never over a
 * broadcast that is still on the radio (`radioBusy`). An approach that
 * reaches the hail radius while suppressed is spent, not deferred, so a hail
 * never fires late, after the moment has passed.
 */
export class HailGate {
  private armed: boolean[];
  private lastHailAt = -Infinity;

  constructor(ships: number) {
    this.armed = Array.from({ length: ships }, () => true);
  }

  /** `now` is game time in seconds. Returns true when ship `i` should hail. */
  update(i: number, dist: number, now: number, raceRunning: boolean, radioBusy = false): boolean {
    if (dist > CARGO_REACT_RADIUS) { this.armed[i] = true; return false; }
    if (dist > CARGO_HAIL_RADIUS || !this.armed[i]) return false;
    this.armed[i] = false;
    if (raceRunning || radioBusy || now - this.lastHailAt < HAIL_COOLDOWN_S) return false;
    this.lastHailAt = now;
    return true;
  }
}
