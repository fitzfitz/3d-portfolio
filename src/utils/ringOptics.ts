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

/** The smallest |μ| and |μ₀| the ring shader uses, so edge-on views and a sun in the ring plane stay finite. */
export const RING_MU_MIN = 1e-3;

/**
 * The radiance a ring layer of normal optical depth `tau` sends the viewer, in
 * units of the sunlight's Lambert radiance (albedo · E/π), mirroring the ring
 * shader in guideLine.ts. μ₀ is the cosine of the sun's direction to the ring
 * normal and μ the viewer's; their signs say which face each is on.
 *
 * Single scattering by an isotropic layer (Chandrasekhar, Radiative Transfer
 * §1; the Lommel–Seeliger law is its thick limit), with x = τ/|μ| and
 * x₀ = τ/|μ₀|:
 * - lit face (sun and viewer on one side), diffuse reflection:
 *   μ₀/(μ₀ + μ) · (1 − e^−(x₀ + x)), the light that gets in along the sun's
 *   path and back out along the viewer's;
 * - unlit face, diffuse transmission:
 *   μ₀/(μ₀ − μ) · (e^−x₀ − e^−x), what a scatter sends on through the rest of
 *   the layer; at μ = μ₀ it tends to x · e^−x.
 * Both tend to τ/|μ| for a thin layer, whatever the sun's elevation, and a
 * thick layer lets nothing through to the unlit face. Each is ×2 so that a
 * thick layer seen and lit face-on matches a Lambert surface.
 */
export function ringRadiance(tau: number, mu0: number, mu: number): number {
  if (tau <= 0) return 0;
  const x = tau / Math.max(Math.abs(mu), RING_MU_MIN);
  const x0 = tau / Math.max(Math.abs(mu0), RING_MU_MIN);
  if (mu * mu0 >= 0) return 2 * (x / (x + x0)) * (1 - Math.exp(-(x + x0)));
  const d = 0.5 * (x - x0);
  // (e^−x₀ − e^−x)/(x − x₀) = e^−(x+x₀)/2 · sinh(d)/d: the series near d = 0, where the difference cancels.
  if (Math.abs(d) < 5e-3) return 2 * x * Math.exp(-0.5 * (x + x0)) * (1 + (d * d) / 6);
  return 2 * x * (Math.exp(-x0) - Math.exp(-x)) / (x - x0);
}
