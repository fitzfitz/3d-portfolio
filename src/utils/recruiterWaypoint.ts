import { afterProbes } from "../data/destinations";
import { PROBE_IDS } from "../data/probes";
import { probePos } from "../store/probeState";
import { nextWaypoint } from "./navigation";

interface Vec3 { x: number; y: number; z: number }

/**
 * The HUD waypoint's target outside a race (WaypointDriver): the nearest
 * project probe whose dossier is unread, at its live spot, then the next
 * destination from the table (`afterProbes`, src/data/destinations.ts) once
 * every dossier is read. Never a body: the bodies stay off the recruiter path.
 */
export function recruiterWaypoint(ship: Vec3, visited: readonly string[], badges: readonly { id: string }[]): string {
  return nextWaypoint(ship, PROBE_IDS, probePos, visited, afterProbes(badges));
}
