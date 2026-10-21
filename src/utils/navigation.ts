import { headingToward } from "./pitchFlight";
import { afterProbes } from "../data/destinations";
import { PROBE_IDS } from "../data/probes";
import { probePos } from "../store/probeState";

interface Vec3 { x: number; y: number; z: number }

export interface JumpPoint extends Vec3 {
  /** Yaw (noseDirection convention) facing the target. */
  yaw: number;
}

/**
 * Where a jump drops the ship: level with the target, `standoff` away on the
 * ship's side, nose-on. Level matters: orbit entry measures the ring radius in
 * the XZ plane, so a point above the body would start the orbit inside it.
 * A ship directly above or below the target has no horizontal side, so it
 * arrives from +Z.
 */
export function jumpPoint(ship: Vec3, target: Vec3, standoff: number): JumpPoint {
  let dx = ship.x - target.x, dz = ship.z - target.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) { dx = 0; dz = 1; } else { dx /= len; dz /= len; }
  const x = target.x + dx * standoff, z = target.z + dz * standoff;
  return { x, y: target.y, z, yaw: headingToward(x, z, target.x, target.z) };
}

/**
 * The nearest of `names` (at `bodies`) not yet in `visited`, then `fallback`
 * once all are. recruiterWaypoint below is the HUD's use of it.
 */
export function nextWaypoint(
  ship: Vec3,
  names: readonly string[],
  bodies: Record<string, Vec3>,
  visited: readonly string[],
  fallback: string,
): string {
  let best = fallback, bestD = Infinity;
  for (const n of names) {
    if (visited.includes(n)) continue;
    const b = bodies[n];
    if (!b) continue;
    const d = Math.hypot(b.x - ship.x, b.y - ship.y, b.z - ship.z);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/**
 * The HUD waypoint's target outside a race (WaypointDriver): the nearest
 * project probe whose dossier is unread, at its live spot, then the next
 * destination from the table (`afterProbes`, src/data/destinations.ts) once
 * every dossier is read. Never a body: the bodies stay off the recruiter path.
 */
export function recruiterWaypoint(ship: Vec3, visited: readonly string[], badges: readonly { id: string }[]): string {
  return nextWaypoint(ship, PROBE_IDS, probePos, visited, afterProbes(badges));
}
