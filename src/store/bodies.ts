import type { BodyId } from "../data/bodyIds";
import { SOLAR_BODIES } from "../data/solarSystem";
import { bodyPositionAt } from "../utils/bodyPositions";

/**
 * Live positions of the nine bodies, by body id, written once per frame by
 * SolarBodies' useFrame (utils/bodyPositions.ts updateBodies) and read by
 * Spaceship (wells, collisions), RadarMap, HUD, and the scannable registry.
 * Mutable outside React — same pattern as `flight`. Seeded at game time 0.
 */
export const bodies: Record<BodyId, { x: number; y: number; z: number }> = Object.fromEntries(
  SOLAR_BODIES.map((b) => [b.id, bodyPositionAt(b, 0, { x: 0, y: 0, z: 0 })] as const),
) as Record<BodyId, { x: number; y: number; z: number }>;
