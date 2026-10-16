/**
 * Dust-tail timing for the comets (Comets.tsx, spec D1-D4).
 *
 * A grain of age `age` was emitted `age` seconds ago at the comet's past
 * position, then pushed anti-sunward by radiation pressure (drift ∝ age²).
 * The world-event visitor flies ~7x faster than an orbiting comet at perihelion
 * (22 vs ~3.2 u/s since comets obey Kepler, docs/UNIVERSE-RULES.md), so the same
 * history would string its 70 grains over ~220u as a dotted line; its
 * EMISSION history is compressed by VISITOR_DUST_AGE to keep the tail dense.
 * Drift and spread must still use the real age, or the tail loses its curve.
 */
export const VISITOR_DUST_AGE = 0.25;

/** Seconds back along the comet's path where a grain of `age` was emitted. */
export function dustEmitBack(age: number, isVisitor: boolean): number {
  return isVisitor ? age * VISITOR_DUST_AGE : age;
}
