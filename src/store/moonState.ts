import { planets } from "../constants";
import { MOONS, moonOffset } from "../data/moons";
import { orbitPosition } from "../utils/orbits";

/**
 * Each moon's world centre, by moon id, mutable outside React like `bodies`
 * (kept out of `bodies`, whose keys are the planets' and worlds' wells).
 * SpacePlanets (the writer) refreshes it every frame from the same angle as
 * the moon's mesh and occluder slot; the ship's collider and camera
 * keep-out read it (utils/worldCollide.ts SOLID_BODIES). Seeded at t = 0.
 */
export const moonCenters: Record<string, { x: number; y: number; z: number }> = Object.fromEntries(
  MOONS.map((m) => {
    const p = orbitPosition(planets[m.planet].orbit, 0);
    const o = moonOffset(m, m.phase, { x: 0, y: 0, z: 0 });
    return [m.id, { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z }] as const;
  }),
);
