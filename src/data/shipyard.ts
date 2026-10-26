import { STATION_RADII, type Vec3 } from "./careerTrail";

/**
 * The shipyard (docs/archive/specs/2026-10-16-shipyard-gate-design.md §1):
 * an open dry dock in the inner system, above the plane on the spawn side, so
 * the hangar is a short trip after a jump. The scene and
 * tests/shipyardGate.test.ts read these same numbers.
 */
export const SHIPYARD_POS: Vec3 = [-70, 59, 45];

/**
 * The model keeps within the career station's radius budget (every vertex
 * within 5.0 of its origin, tests/assetContracts.test.ts), so it docks with
 * the station's radii: jumpR parks the whole ship clear of the hull.
 */
export const SHIPYARD_RADII = { ...STATION_RADII };

/** Accent colour: radar blip, sector list, hangar dialog. */
export const SHIPYARD_BLUE = "#5b8cff";
