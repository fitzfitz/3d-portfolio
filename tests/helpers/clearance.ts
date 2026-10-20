/**
 * Clearance helpers shared by the landmark placement tests (careerTrail,
 * shipyardGate, spawn, probes). Orbit clearance against the real Solar System
 * lives in solarClearance.ts; this holds the point and scenery-belt helpers.
 */
export const MARGIN = 4;

export const d3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
