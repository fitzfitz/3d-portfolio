/**
 * The rings (docs/UNIVERSE-RULES.md L14, L20): Saturn's extent and optical
 * depth scale, Uranus's epsilon ring, the live sunlight on them, and pure
 * mirrors of the optics the GLSL computes (the ring shader in guideLine.ts,
 * the ring-shadow patch in sunShadow.ts).
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

/**
 * The ringed giant's reach in equatorial radii: its A ring ends at RING_OUT
 * (2.27), rounded up. Its clearances and crystal keep-out cover it.
 */
export const RING_REACH_FACTOR = 2.3;

/** The rings' inner and outer radii (u) around a world of equatorial radius `size`. */
export function ringRadii(size: number): [number, number] {
  return [RING_IN * size, RING_OUT * size];
}

/**
 * The sunlight on a ring `rAU` from the Sun as a fraction of 1 AU's: 1 / rAU²
 * (L19, the rims' irradianceVsAU in AU). Written into each ring's uniform every
 * frame from its planet's live distance (spec §4.8): Saturn's rings get about
 * 24% more light at perihelion than at aphelion.
 */
export function ringIrradiance(rAU: number): number {
  return 1 / (rAU * rAU);
}

/**
 * Uranus's epsilon ring, its brightest and widest (Voyager 2 and stellar
 * occultations: Elliot & Nicholson 1984; French et al. 1991, Icarus 89):
 * semi-major axis 51,149 km over Uranus's 25,559 km equatorial radius (NSSDC),
 * so 2.00 R; 20-96 km wide (it is eccentric: narrow and dense at periapsis,
 * wide and thinner at apoapsis); normal optical depth about 0.5-2.5; particle
 * albedo about 0.02 (charcoal-dark). Drawn circular, at a visible minimum
 * width of 0.02 R (511 km, a disclosed convention: 96 km would be under a
 * pixel from anywhere a ring is in frame), its τ running across that width
 * between the measured extremes.
 */
export const URANUS_EPSILON = {
  radiusKm: 51_149,
  planetRadiusKm: 25_559,
  widthKm: [20, 96] as const,
  drawnWidthR: 0.02,
  tau: [0.5, 2.5] as const,
  albedo: 0.02,
} as const;

/** The epsilon ring's radius in Uranus radii: 2.0012. */
export const URANUS_RING_R = URANUS_EPSILON.radiusKm / URANUS_EPSILON.planetRadiusKm;

/** The epsilon ring's drawn inner and outer radii (u) around Uranus of equatorial radius `size`. */
export function uranusRingRadii(size: number): [number, number] {
  const h = URANUS_EPSILON.drawnWidthR / 2;
  return [(URANUS_RING_R - h) * size, (URANUS_RING_R + h) * size];
}

/**
 * The epsilon ring's normal optical depth at `u` across its drawn width (0 the
 * inner edge, 1 the outer): 0.5 at the edges rising to 2.5 mid-ring, the
 * measured range.
 */
export function uranusRingTau(u: number): number {
  const [lo, hi] = URANUS_EPSILON.tau;
  return lo + (hi - lo) * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
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
