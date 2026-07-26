import type { OrbitalElements } from "./utils/orbits";
import projectsData from "./data/projects.json";

export interface Project {
  /**
   * Stable identity, and also the planet's `name` and the store's `activeZone`
   * value. Changing it renames the planet and breaks any saved reference to it.
   */
  id: string;
  title: string; role: string; duration: string; short: string;
  description: string; tech: string[]; color: string;
  /** Public repo URL. Falls back to the profile when a project has none. */
  repo?: string;
}
export interface PlanetData {
  name: string; orbit: OrbitalElements; color: string; size: number;
}

/**
 * Zone ids the engine reserves for non-project destinations. A project may not
 * claim one — `activeZone === "contact"` is the portal, and a project with that
 * id would make flying to the portal open a project dossier instead.
 */
export const RESERVED_ZONE_IDS = ["contact"] as const;

export const COSMIC_BOUNDS = 250;
// Off-plane destination: pilots must climb to reach the contact portal (spec §3).
export const PORTAL_POS: [number, number, number] = [0, 95, -150];
export const SHIP_MAX_SPEED = 10.8;
/** Warp velocity while boost is held. 3.6x cruise; fuel endurance is tuned against it. */
export const SHIP_WARP_SPEED = 39;

// Orbit-lock geometry: ORBIT must stay well inside RETAIN or the lock
// self-destructs one frame after engaging (see tests/orbitInvariant.test.ts).
export const ZONE_FACTOR = 1.8;        // gravity-tip radius = size * this
export const LOCK_ENGAGE_FACTOR = 1.3; // lock engages inside size * this
export const LOCK_RETAIN_FACTOR = 1.9; // once locked, retained until size * this
export const ORBIT_RADIUS_FACTOR = 1.5; // orbit-entry ring = size * this
export const PORTAL_ZONE_R = 2.2;
export const PORTAL_LOCK_R = 1.5;
export const PORTAL_RETAIN_R = 3.4;
export const PORTAL_ORBIT_R = 2.6;

/**
 * Project content lives in `src/data/projects.json` so it can be edited as data.
 * JSON gets no compile-time checking against `Project`, so `tests/projects.test.ts`
 * is that check — required fields, hex colours, unique non-reserved ids.
 */
export const projects: Project[] = projectsData;

/** Planet physical size. Uniform today; per-planet if that ever changes. */
const PLANET_SIZE = 4.8;

/**
 * Inclined living orbits around the sun at origin (spec §3), keyed by project id.
 * Periods are minutes-slow: orbital speed stays ≪ ship speed so orbit-lock
 * tracking is trivial (tests/orbitInvariant.test.ts).
 *
 * These stay in code rather than the content JSON because they are tuning
 * constants, balanced against the lock radii above, the belt (r 40-70), the
 * polar halo (80-95) and the portal at y=95. Adding a project therefore forces
 * a deliberate orbital decision — `tests/projects.test.ts` fails on a project
 * with no entry here, and on an entry with no project.
 */
export const PLANET_ORBITS: Record<string, OrbitalElements> = {
  saas: { radius: 115, angularSpeed: (Math.PI * 2) / 420, inclination: 0.3491, node: 0, phase: 0 },
  video: { radius: 150, angularSpeed: (Math.PI * 2) / 510, inclination: -0.6981, node: 2.0944, phase: 2.1 },
  agent: { radius: 185, angularSpeed: (Math.PI * 2) / 600, inclination: 1.0472, node: 4.1888, phase: 4.2 },
};

const byId = new Map(projects.map((p) => [p.id, p]));

/** Resolves a zone id to its project. Undefined for the portal and unknowns. */
export function projectById(zoneId: string | null): Project | undefined {
  return zoneId === null ? undefined : byId.get(zoneId);
}

/**
 * The planets the engine flies through, derived by joining each project to its
 * orbital elements. Colour is single-sourced from the project — it used to be
 * duplicated here and had to be kept in sync by hand.
 *
 * A project with no orbit is dropped rather than crashing at import time, since
 * throwing here would take down the whole 3D canvas; the test suite is what
 * catches it loudly.
 */
export const planets: PlanetData[] = projects
  .filter((p) => p.id in PLANET_ORBITS)
  .map((p) => ({ name: p.id, color: p.color, size: PLANET_SIZE, orbit: PLANET_ORBITS[p.id] }));
