import { keplerGM, keplerOmega } from "./utils/kepler";
import { activeContent, type Project } from "./data/content";

export type { Project };
/**
 * The playable system: past this radius a return burn pushes the ship back
 * (utils/edgeHaze.ts). 31.3 AU: Neptune's aphelion (3,488) plus its well and
 * the haze padding fit inside (real-solar-system spec §6.1).
 */
export const SYSTEM_RADIUS = 3600;
/**
 * The Worker-shared acceptance bound (beacon-api validates positions against it).
 * Deliberately generous and fixed, not derived from SYSTEM_RADIUS: the playable
 * edge can move out later without a Worker redeploy. Raising THIS value means
 * deploying beacon-api first.
 */
export const VALIDATION_RADIUS = 3800;

/** The scale the player ship (spaceship.glb) is rendered at; tests/assetContracts.test.ts sizes the career dock standoff from it. */
export const PLAYER_SHIP_SCALE = 0.35;
/**
 * Sun core radius: the solid sphere, bigger than any planet (Jupiter's 22), so
 * the star outsizes its planets (docs/UNIVERSE-RULES.md L35, fix F12). The
 * corona billboard (72 wide, sunMaterials.ts) ends well inside the main belt (2.1 AU, about 241 u).
 */
export const SUN_RADIUS = 24;
// Off-plane destination: pilots must climb to reach the contact portal (spec §3).
export const PORTAL_POS: [number, number, number] = [0, 95, -150];
export const SHIP_MAX_SPEED = 10.8;
/** Warp velocity while boost is held. 3.6x cruise; fuel endurance is tuned against it. */
export const SHIP_WARP_SPEED = 39;

// Planet keep-out radii, in planet sizes. They were the orbit-lock radii
// until the projects moved onto probes (planets no longer dock); what is
// placed around the planets (crystals, convoys, jellyfish, the clearance
// tests) is still spaced by them.
export const ZONE_FACTOR = 1.8;        // the old proximity zone
export const LOCK_ENGAGE_FACTOR = 1.3; // the old lock-engage radius
export const LOCK_RETAIN_FACTOR = 1.9; // the old lock-retain radius
// Destination (contact portal) lock geometry: ORBIT must stay well inside
// RETAIN or the lock self-destructs one frame after engaging
// (see tests/orbitInvariant.test.ts).
export const PORTAL_ZONE_R = 2.2;
export const PORTAL_LOCK_R = 1.5;
export const PORTAL_RETAIN_R = 3.4;
export const PORTAL_ORBIT_R = 2.6;

/**
 * The projects for this visit, in their `sort` order: beacon-api's D1
 * `projects` table when it answered, else the bundled `src/data/projects.json`
 * (src/data/content.ts). Rows from D1 are validated on the way in
 * (src/utils/contentParse.ts); `tests/projects.test.ts` checks the bundled file.
 */
export const projects: readonly Project[] = activeContent().projects;

/**
 * The sun's pull, GM (docs/UNIVERSE-RULES.md L7). Every orbit around the sun
 * (belt, Trojans, comets) takes its speed from this one value through
 * Kepler's third law, anchored so 1 AU (r 115) keeps a 420 s year; the
 * planets' own mean motions are JPL's and agree with it (utils/ephemeris.ts).
 */
/** Scene units per AU (docs/UNIVERSE-RULES.md "Units"). */
export const AU = 115;
/** Game seconds per Julian year: the orrery clock's rate (utils/orreryClock.ts). */
export const YEAR_S = 420;
export const GM_SUN = keplerGM(AU, YEAR_S);
/** Angular speed (rad/s) of a circular orbit of radius `r` around the sun. */
export const sunOmega = (r: number): number => keplerOmega(r, GM_SUN);

/**
 * Sign of a `rotation.y` rate that turns the same way the planets orbit
 * (docs/UNIVERSE-RULES.md L9). The real system turns counter-clockwise seen
 * from ecliptic north, which is world +Y (utils/ephemeris.ts eclipticToWorld,
 * a proper rotation), so prograde is a positive rotation about Y: angular
 * momentum along +Y. tests/universeRules.test.ts measures this rather than
 * trusting it.
 */
export const PROGRADE = 1;

const byId = new Map(projects.map((p) => [p.id, p]));

/** Resolves a project (probe) id to its project. Undefined for destinations and unknowns. */
export function projectById(id: string | null): Project | undefined {
  return id === null ? undefined : byId.get(id);
}

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
