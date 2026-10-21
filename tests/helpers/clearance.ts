/**
 * Clearance helpers shared by the landmark placement tests (careerTrail,
 * shipyardGate, spawn, probes). Orbit clearance against the real Solar System
 * lives in solarClearance.ts; this holds the point helpers.
 */
export const MARGIN = 4;

export const d3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
