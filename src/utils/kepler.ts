export interface CometOrbit {
  /** semi-major axis (world units) */
  a: number;
  /** eccentricity 0..<1 — higher = more dramatic slingshot */
  e: number;
  periodSeconds: number;
  /** mean-anomaly offset (radians) so comets don't sync up */
  phase: number;
  /** orbital-plane tilt: y = z * tilt */
  tilt: number;
}

/**
 * Keplerian orbit position with the sun at the FOCUS (origin): the body
 * whips past perihelion and crawls at aphelion, per Kepler's second law.
 * Solves Kepler's equation E - e·sinE = M with a few Newton iterations.
 */
export function keplerPosition(
  tSeconds: number,
  o: CometOrbit
): { x: number; y: number; z: number } {
  const M = ((tSeconds / o.periodSeconds) * Math.PI * 2 + o.phase) % (Math.PI * 2);
  let E = M;
  for (let i = 0; i < 5; i++) {
    E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
  }
  const x = o.a * (Math.cos(E) - o.e);
  const z = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  return { x, y: z * o.tilt, z };
}
