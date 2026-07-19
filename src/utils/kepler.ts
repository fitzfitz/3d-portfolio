export interface CometOrbit {
  /** semi-major axis (world units) */
  a: number;
  /** eccentricity 0..<1 — higher = more dramatic slingshot */
  e: number;
  periodSeconds: number;
  /** mean-anomaly offset (radians) so comets don't sync up */
  phase: number;
  /** orbital-plane inclination (rad, rotation about X — same convention as utils/orbits.ts) */
  inclination: number;
  /** ascending-node rotation (rad, about Y, applied after inclination) */
  node: number;
}

/**
 * Keplerian orbit position with the sun at the FOCUS (origin): the body
 * whips past perihelion and crawls at aphelion, per Kepler's second law.
 * Solves Kepler's equation E - e·sinE = M with a few Newton iterations,
 * then rotates the in-plane ellipse by inclination and node.
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
  const x0 = o.a * (Math.cos(E) - o.e);
  const z0 = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const ci = Math.cos(o.inclination), si = Math.sin(o.inclination);
  const y1 = -z0 * si;
  const z1 = z0 * ci;
  const cn = Math.cos(o.node), sn = Math.sin(o.node);
  return { x: x0 * cn + z1 * sn, y: y1, z: -x0 * sn + z1 * cn };
}
