/**
 * The ringed giant's rings (docs/UNIVERSE-RULES.md L14, L20): their extent,
 * their optical depth scale, and pure mirrors of the optics the GLSL computes
 * (the ring shader in guideLine.ts, the ring-shadow patch in sunShadow.ts).
 */

/**
 * Strip extent in equatorial radii: u = 0 at the C ring's inner edge, u = 1 at
 * the A ring's outer edge (the same numbers as scripts/textures/gen_worlds.mjs,
 * which writes the strip; tests/ringOptics.test.ts holds them equal).
 */
export const RING_IN = 1.24;
export const RING_OUT = 2.27;

/** The strip's alpha is τ / RING_TAU_MAX, so τ = A · RING_TAU_MAX (gen_worlds.mjs). */
export const RING_TAU_MAX = 4;

/** The rings' inner and outer radii (u) around a world of equatorial radius `size`. */
export function ringRadii(size: number): [number, number] {
  return [RING_IN * size, RING_OUT * size];
}

/** The ringed giant's mean density (g/cm³), its namesake Saturn's. */
export const RINGED_GIANT_DENSITY = 0.69;
/** Water ice, what the ring particles are made of (g/cm³). */
export const RING_ICE_DENSITY = 0.92;

/**
 * The fluid Roche limit in planet radii (L14): 2.44 · (ρ_planet / ρ_particle)^(1/3).
 * For the ringed giant's ice rings, ≈ 2.22: the A ring's edge (2.27) sits at it.
 */
export function fluidRocheLimit(planetDensity: number, particleDensity: number): number {
  return 2.44 * Math.cbrt(planetDensity / particleDensity);
}

/**
 * What the viewer sees of a ring of normal optical depth `tau`, μ being the
 * cosine of the view ray's angle to the ring normal: 1 − exp(−τ/|μ|). Thin
 * face-on, opaque edge-on, from either face.
 */
export function ringViewOpacity(tau: number, mu: number): number {
  return 1 - Math.exp(-tau / Math.abs(mu));
}

/**
 * The sunlight a ring lets through to its planet: exp(−τ/μ₀), μ₀ being the
 * sine of the sun's elevation above the ring plane. It has no viewer term, so
 * the rings' shadow does not move with the camera.
 */
export function ringTransmission(tau: number, mu0: number): number {
  return Math.exp(-tau / mu0);
}
