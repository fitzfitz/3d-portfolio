import {
  PORTAL_POS, PORTAL_ZONE_R, PORTAL_LOCK_R, PORTAL_RETAIN_R, PORTAL_ORBIT_R, planets, projectById, type PlanetData,
} from "../constants";
import { STATION_POS, STATION_RADII, CAREER_AMBER } from "./careerTrail";
import { SHIPYARD_POS, SHIPYARD_RADII, SHIPYARD_BLUE } from "./shipyard";

/**
 * Places you can jump to and dock at that are not project planets
 * (docs/superpowers/specs/2026-10-15-career-landmarks-design.md §2). Every
 * consumer that used to special-case "contact" reads this table instead:
 * zone detection and lock (SpacePlanets), lock geometry and jumps
 * (Spaceship), jump validation and the dock badge (spaceStore), the radar,
 * the waypoint, the HUD sector list, the jump keys and scannables. A new
 * landmark is one row. Table order is key order, after the planets.
 */
export type DestinationId = "contact" | "career" | "shipyard";

export interface Destination {
  id: DestinationId;
  /** HUD and waypoint label, e.g. "CONTACT PORTAL". */
  label: string;
  /** Jump-list label on the spawn card, e.g. "Contact". */
  jumpLabel: string;
  /** Scanner label, HUD sector-list name and HUD target, e.g. "PORTAL_SUN". */
  scanLabel: string;
  pos: readonly [number, number, number];
  color: string;
  /** Proximity zone: the "fly closer" tip and the HUD target. */
  zoneR: number;
  /** Orbit lock engages inside this radius. */
  lockR: number;
  /** Once locked, the lock holds until the ship leaves this radius. */
  retainR: number;
  /** The docked ship's orbit radius. Must sit inside retainR (tests/orbitInvariant.test.ts). */
  orbitR: number;
  /** A jump parks the ship this far out: inside lockR so it docks on arrival, outside the model. */
  jumpR: number;
  /**
   * Whether the guided waypoint may point here (afterPlanets). The shipyard is
   * a place to visit, not a step of the recruiter path, and has no logbook
   * entry, so without this it would capture the waypoint forever.
   */
  waypoint: boolean;
}

export const DESTINATIONS: readonly Destination[] = [
  // Key 4. Radii in careerTrail.ts, next to the placement they were tested with.
  {
    id: "career", label: "CAREER STATION", jumpLabel: "Career", scanLabel: "STATION_CAREER", pos: STATION_POS,
    color: CAREER_AMBER, waypoint: true, ...STATION_RADII,
  },
  // Key 5. Docking opens the Hangar (App.tsx).
  {
    id: "shipyard", label: "SHIPYARD", jumpLabel: "Shipyard", scanLabel: "DRYDOCK_01", pos: SHIPYARD_POS,
    color: SHIPYARD_BLUE, waypoint: false, ...SHIPYARD_RADII,
  },
  // Key 6.
  {
    id: "contact", label: "CONTACT PORTAL", jumpLabel: "Contact", scanLabel: "PORTAL_SUN", pos: PORTAL_POS, color: "#ec4899",
    waypoint: true,
    zoneR: PORTAL_ZONE_R, lockR: PORTAL_LOCK_R, retainR: PORTAL_RETAIN_R, orbitR: PORTAL_ORBIT_R, jumpR: PORTAL_LOCK_R * 0.8,
  },
];

/**
 * Zone ids the engine reserves. A project may not claim one: `activeZone` is
 * the project id for planets, so a project named "contact" would make flying
 * to the portal open a project dossier instead (tests/projects.test.ts).
 */
export const RESERVED_ZONE_IDS: readonly DestinationId[] = DESTINATIONS.map((d) => d.id);

/**
 * The bodies the zone/lock loop (SpacePlanets) checks before the
 * destinations: the project planets only. A world there would soft-lock the
 * loop, with no dossier to open (spec, "Separate table").
 */
export const ZONE_PLANETS: readonly PlanetData[] = planets;

/**
 * The bodies the guided waypoint (WaypointDriver) walks before the
 * destinations: the project planets' names only, never `Object.keys(bodies)`,
 * which also holds the worlds (spec, "Separate table").
 */
export const WAYPOINT_PLANET_NAMES: readonly string[] = planets.map((p) => p.name);

const byId = new Map<string, Destination>(DESTINATIONS.map((d) => [d.id, d]));

/** The destination with this zone id; undefined for planets, null and unknowns. */
export function destinationById(id: string | null | undefined): Destination | undefined {
  return id ? byId.get(id) : undefined;
}

/** Spaceship's ESCAPE_MARGIN (1.15) × 1.5, the push the portal always used. */
const ESCAPE_FACTOR = 1.15 * 1.5;

/** Breaking orbit at a destination puts the ship this far out: past its zone and its retain radius. */
export function escapeR(d: Destination): number {
  return d.zoneR * ESCAPE_FACTOR;
}

export interface JumpTarget { id: string; label: string; color: string }

/** Number keys, the spawn card and the d-pad, in order: each planet's project, then every destination. */
export const JUMP_TARGETS: readonly JumpTarget[] = [
  ...planets.map((p) => ({ id: p.name, label: projectById(p.name)?.title ?? p.name, color: p.color })),
  ...DESTINATIONS.map((d) => ({ id: d.id, label: d.jumpLabel, color: d.color })),
];

/** The number key (1-based) that jumps to `id`; 0 if nothing does. */
export function jumpKey(id: string): number {
  return JUMP_TARGETS.findIndex((t) => t.id === id) + 1;
}

const WAYPOINT_ROWS = DESTINATIONS.filter((d) => d.waypoint);

/**
 * Where the waypoint points once every planet dossier is read: the first
 * waypoint destination (table order) whose logbook badge is not recorded
 * yet, and the last one (the contact portal) once all are. Rows with
 * `waypoint: false` (the shipyard) are never returned.
 */
export function afterPlanets(badges: readonly { id: string }[]): DestinationId {
  const open = WAYPOINT_ROWS.find((d) => !badges.some((b) => b.id === d.id));
  return (open ?? WAYPOINT_ROWS[WAYPOINT_ROWS.length - 1]).id;
}
