import { planets } from "../../src/constants";
import { orbitPosition } from "../../src/utils/orbits";

/**
 * Clearance helpers shared by the landmark placement tests
 * (careerTrail.test.ts, shipyardGate.test.ts), same approach as
 * planetClearance.test.ts.
 */
export const SAMPLES = 2000;
/**
 * A planet's reach: its farthest moon is fuxx's ice moon, orbiting at 2.1 ×
 * size with radius 0.0625 × size (SpacePlanets.tsx), so 2.2 × size covers
 * the planet, its proximity zone (1.8 ×) and every moon.
 */
export const MOON_REACH_FACTOR = 2.2;
export const MARGIN = 4;

export const d3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Closest approach of a planet's centre, over a full orbit, to a fixed point. */
export function closestApproach(planet: (typeof planets)[number], p: readonly number[]): number {
  let min = Infinity;
  const period = (Math.PI * 2) / planet.orbit.angularSpeed;
  for (let k = 0; k < SAMPLES; k++) {
    const q = orbitPosition(planet.orbit, (k / SAMPLES) * period);
    min = Math.min(min, Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]));
  }
  return min;
}

/**
 * Distance above or below a tilted asteroid ring (AsteroidBelt.tsx: tilt about
 * X, ring radius rMin..rMax, rocks within ±halfThickness of its plane), or
 * Infinity when the point is outside the ring's radial band.
 */
export function beltClearance(p: readonly number[], tilt: number, rMin: number, rMax: number, halfThickness: number): number {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const ly = c * p[1] + s * p[2];
  const lz = -s * p[1] + c * p[2];
  const r = Math.hypot(p[0], lz);
  return r < rMin - MARGIN || r > rMax + MARGIN ? Infinity : Math.abs(ly) - halfThickness;
}
