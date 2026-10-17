import type { OrbitalElements } from "./utils/orbits";
import { keplerGM, keplerOmega } from "./utils/kepler";
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
  type: PlanetType; mass: number;
}
export type PlanetType = "earth" | "gas-giant" | "mars";

/** The playable system: past this radius a return burn pushes the ship back (utils/edgeHaze.ts). */
export const SYSTEM_RADIUS = 400;
/**
 * The Worker-shared acceptance bound (beacon-api validates positions against it).
 * Deliberately generous and fixed, not derived from SYSTEM_RADIUS: the playable
 * edge can move out later without a Worker redeploy. Raising THIS value means
 * deploying beacon-api first.
 */
export const VALIDATION_RADIUS = 520;

/** The scale the player ship (spaceship.glb) is rendered at; tests/assetContracts.test.ts sizes the career dock standoff from it. */
export const PLAYER_SHIP_SCALE = 0.35;
/**
 * Sun core radius: the solid sphere, bigger than any planet (16 at most), so
 * the star outsizes its planets (docs/UNIVERSE-RULES.md L35, fix F12). The
 * corona billboard (72 wide, sunMaterials.ts) ends inside the belt's r 40.
 */
export const SUN_RADIUS = 24;
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

/**
 * Planet size, type and relative mass, by project id (2026-10-17, sub-project B):
 * size follows type — gas giant 16 > earth 12 > mars 8 — so the sun can outsize
 * every planet (L35/L36). Masses are compressed but correctly ordered (P3).
 * Size was a uniform 16 (4.8 before 2026-10-12); every lock radius scales off
 * it, and tests/planetClearance.test.ts guards what is placed around the orbits.
 */
export const PLANET_PROPS: Record<string, { type: PlanetType; size: number; mass: number }> = {
  ruangrapi: { type: "earth", size: 12, mass: 1 },
  portfolio: { type: "gas-giant", size: 16, mass: 3 },
  fuxx: { type: "mars", size: 8, mass: 0.3 },
};

/**
 * The sun's pull, GM (docs/UNIVERSE-RULES.md L7). Every orbit around the sun
 * (planets, belt, halo, comets) takes its speed from this one value through
 * Kepler's third law, anchored so Ruangrapi (r 115) keeps its 420 s year.
 */
/** Scene units per AU: Ruangrapi's orbit radius (docs/UNIVERSE-RULES.md "Units"). */
export const AU = 115;
/** Game seconds per Earth year: Ruangrapi's period. */
export const YEAR_S = 420;
export const GM_SUN = keplerGM(AU, YEAR_S);
/** Angular speed (rad/s) of a circular orbit of radius `r` around the sun. */
export const sunOmega = (r: number): number => keplerOmega(r, GM_SUN);

/**
 * Ruangrapi's pull, GM, anchored so its moon (1.7 × its size 12) keeps 0.4 rad/s.
 * Every planet's own pull is this × its relative mass (`gmOf`), so L7 holds
 * within each moon system (one GM per central body). Moon systems are magnified
 * insets on their own clock (principle P3, law L13), so this is not comparable
 * with GM_SUN.
 */
export const GM_RUANGRAPI = keplerGM(12 * 1.7, (Math.PI * 2) / 0.4);
/** One planet's pull, GM_RUANGRAPI × its mass (docs/UNIVERSE-RULES.md L11). */
export const gmOf = (p: PlanetData): number => GM_RUANGRAPI * p.mass;

/**
 * Sign of a `rotation.y` rate that turns the same way the planets orbit
 * (docs/UNIVERSE-RULES.md L9). `orbitPosition` with a positive angularSpeed
 * runs clockwise seen from +Y, which is a negative rotation about Y.
 * tests/universeRules.test.ts measures this rather than trusting it.
 */
export const PROGRADE = -1;

/**
 * Inclined living orbits around the sun at origin (spec §3), keyed by project id.
 * Speeds follow Kepler's third law (sunOmega), so outer planets are slower.
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
  ruangrapi: { radius: 115, angularSpeed: sunOmega(115), inclination: 0.3491, node: 0, phase: 0 }, // 420 s
  portfolio: { radius: 150, angularSpeed: sunOmega(150), inclination: -0.6981, node: 2.0944, phase: 2.1 }, // ~626 s
  fuxx: { radius: 185, angularSpeed: sunOmega(185), inclination: 1.0472, node: 4.1888, phase: 4.2 }, // ~857 s
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
  .map((p) => ({ name: p.id, color: p.color, ...PLANET_PROPS[p.id], orbit: PLANET_ORBITS[p.id] }));

/**
 * Hard ceiling on simultaneous lights in the scene.
 *
 * Three.js bakes the light count into every shader's program cache key, so
 * adding one light bumps lightsStateVersion and forces EVERY material in the
 * scene to recompile on the next frame -- a synchronous, scene-wide stall.
 * This is not a shading-cost budget, it is a "do not recompile during play"
 * budget, and it is why particles must never carry their own light.
 *
 * It is also a shading-cost budget in practice: every lit fragment loops over
 * every light. 2026-10-10 cut it from 10 to 4 — a duplicate sun light, three
 * planet "glow" lights sealed inside opaque spheres (they only tinted moons
 * and the ship), a 1.2u ship light, and one of the portal's pair (merged:
 * PortalRing drives one light with both flickers).
 *
 * Current occupants, measured (not enumerated by hand — an earlier hand count
 * missed the ambientLight): ambientLight + sun point (GlobalCanvas.tsx),
 * engine glow (Spaceship.tsx), portal (PortalRing.tsx).
 * Asserted by tests/e2e/transition.probe.mjs.
 */
export const LIGHT_BUDGET = 4;
