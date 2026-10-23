import { DESTINATIONS } from "../data/destinations";
import { PROBE_IN_RANGE } from "../data/probes";
import { SOLAR_BODIES } from "../data/solarSystem";
import { BODY_IDS } from "../data/bodyIds";
import { probePos } from "../store/probeState";
import type { ChartRecord } from "./charting";
import { essentialsDone, nextGoal, type LogbookProgress } from "./logbook";
import { nextWaypoint } from "./navigation";
import { recruiterWaypoint } from "./recruiterWaypoint";
import { SCAN_RANGE } from "./scannables";

interface Vec3 { x: number; y: number; z: number }

/**
 * Where the logbook's next step is, for the HUD waypoint (WaypointDriver) and
 * the jellyfish guide (spec 2026-10-23-jellyfish-guide, "Leading": "one source
 * of truth with the HUD's NEXT line and target lock"; controller ruling R1).
 * Written into a caller-owned object so the frame loops allocate nothing.
 */
export interface WaypointTarget extends Vec3 {
  /** A probe id, a destination id or a body id. */
  id: string;
  /**
   * Arrival: the ship within this of the point. The radius at which the HUD's
   * own target locks on: a probe's PROBE_IN_RANGE (`probeNear`, the TARGET
   * line), a destination's zone (`activeZone`), a body's scan reach.
   */
  radius: number;
}

export function createWaypointTarget(): WaypointTarget {
  return { id: "", x: 0, y: 0, z: 0, radius: 0 };
}

/** Destinations are fixed points; built once so the frame loop allocates nothing. */
const DESTINATION_POINTS = new Map<string, Vec3 & { r: number }>(
  DESTINATIONS.map((d) => [d.id, { x: d.pos[0], y: d.pos[1], z: d.pos[2], r: d.zoneR }]),
);
/** Bodies scan from their surface (scannables.ts), so a body is reached at size + SCAN_RANGE. */
const BODY_REACH = new Map<string, number>(SOLAR_BODIES.map((b) => [b.id, b.size + SCAN_RANGE]));

/**
 * A destination or a probe (as WaypointDriver always resolved it: the table
 * point, else the probe's live spot) into `out`. False if `id` is neither.
 * Leaves `out.id` alone.
 */
export function placeTarget(id: string, out: WaypointTarget): boolean {
  const d = DESTINATION_POINTS.get(id);
  const p = d ?? probePos[id];
  if (!p) return false;
  out.x = p.x; out.y = p.y; out.z = p.z;
  out.radius = d ? d.r : PROBE_IN_RANGE;
  return true;
}

/**
 * The HUD waypoint outside a race: recruiterWaypoint's id, placed. Writes
 * `out.id` even when the id has no position (WaypointDriver still compares it
 * with the active zone); returns whether it has one.
 */
export function recruiterTarget(ship: Vec3, visited: readonly string[], badges: readonly { id: string }[], out: WaypointTarget): boolean {
  out.id = recruiterWaypoint(ship, visited, badges);
  return placeTarget(out.id, out);
}

/**
 * The guide's target (ruling R1). Until the essentials are done it is the HUD
 * waypoint, exactly. Then the logbook's next goals are badges (a slingshot, a
 * comet), which are activities, not places, so it leads to the nearest
 * uncharted body instead (CARTOGRAPHER), with the charted bodies as visited.
 * False (null: it roams) when the logbook has no next goal or every body is
 * charted.
 *
 * A memo per caller: essentialsDone, nextGoal and the charted id list are
 * recomputed only when the store hands over a new array, so a steady frame
 * does no logbook scan and allocates nothing (the store replaces, never
 * mutates, these arrays).
 */
export function makeGuideTarget(): (
  ship: Vec3, progress: LogbookProgress, charted: readonly ChartRecord[], bodies: Readonly<Record<string, Vec3>>, out: WaypointTarget,
) => boolean {
  let lastVisited: readonly string[] | null = null;
  let lastShards: readonly number[] | null = null;
  let lastBadges: readonly { id: string }[] | null = null;
  let essentials = false, goalLeft = true;
  let lastCharted: readonly ChartRecord[] | null = null;
  let chartedIds: readonly string[] = [];
  return (ship, progress, charted, bodies, out) => {
    if (progress.visitedDossiers !== lastVisited || progress.shardsCollected !== lastShards || progress.badges !== lastBadges) {
      lastVisited = progress.visitedDossiers; lastShards = progress.shardsCollected; lastBadges = progress.badges;
      essentials = essentialsDone(progress);
      goalLeft = nextGoal(progress) !== null;
    }
    if (!goalLeft) return false;
    if (!essentials) return recruiterTarget(ship, progress.visitedDossiers, progress.badges, out);
    if (charted !== lastCharted) { lastCharted = charted; chartedIds = charted.map((c) => c.id); }
    const id = nextWaypoint(ship, BODY_IDS, bodies, chartedIds, "");
    const b = id ? bodies[id] : undefined;
    if (!b) return false;
    out.id = id;
    out.x = b.x; out.y = b.y; out.z = b.z;
    out.radius = BODY_REACH.get(id) ?? SCAN_RANGE;
    return true;
  };
}
