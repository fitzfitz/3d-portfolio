import { AU } from "../constants";

/**
 * The physics behind every number a world states (spec "Built to scale",
 * rule 2): facts are computed from the world's orbit, never typed in, so a
 * moved world stays true. The star is the Sun, with 1 AU = AU scene units.
 */

/**
 * Equilibrium temperature at 1 AU of a body with zero Bond albedo that
 * re-radiates over its whole sphere: (S(1 − A) / 4σ)^¼ with S ≈ 1367 W/m².
 */
export const T_EQ_1AU_K = 278.6;

/** Stellar flux at radius r, in S⊕ (Earth's sunlight): inverse-square in AU. */
export const fluxEarth = (r: number): number => (AU / r) ** 2;

/** Equilibrium temperature (K) at radius r: T = 278.6 K · (1 − A)^¼ / √(r/AU). */
export const equilibriumTempK = (r: number, bondAlbedo: number): number =>
  (T_EQ_1AU_K * (1 - bondAlbedo) ** 0.25) / Math.sqrt(r / AU);

export const kToC = (k: number): number => k - 273.15;
