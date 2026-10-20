import { SOLAR_MOONS, type MoonId } from "../data/solarMoons";
import { bodyById } from "../data/solarSystem";
import { bodyPositionAt } from "../utils/bodyPositions";
import { moonPositionAt } from "../utils/moonOrbits";
import type { Vec3 } from "../utils/reactions";

/**
 * Each moon's world centre, by moon id, mutable outside React like `bodies`
 * (kept out of `bodies`, whose keys are the bodies' wells). SolarMoons (the
 * writer, through moonOrbits.ts updateMoons) refreshes it every frame from
 * the same position as the moon's mesh and occluder slot; the ship's collider,
 * camera keep-out and cruise read it (utils/worldCollide.ts SOLID_BODIES,
 * Spaceship's CRUISE_SPHERES). Seeded at game time 0.
 */
export const moonPositions: Record<MoonId, Vec3> = Object.fromEntries(
  SOLAR_MOONS.map((m) => [m.id, moonPositionAt(m, 0, bodyPositionAt(bodyById(m.parent), 0, { x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 })]),
) as Record<MoonId, Vec3>;
