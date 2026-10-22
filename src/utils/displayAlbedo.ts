import { SOLAR_MOONS } from "../data/solarMoons";
import { SOLAR_BODIES, bodyById } from "../data/solarSystem";

/**
 * One shared display curve for dark surfaces (docs/UNIVERSE-RULES.md P3, a
 * disclosed convention). Very dark surfaces are drawn brighter than their true
 * albedo so they stay visible; their relative order is real.
 *
 * The input is one statistic for every body: the median linear luminance of
 * its shipped map (`texelMedianLinear` in SOLAR_BODIES). The output
 * multiplies the body's material colour, a uniform, so no shader changes.
 *
 * - At and above the knee, Earth's own map statistic (0.0766, its mean
 *   under its cloud layer: 0.177 × its geometric albedo 0.434), the gain is 1:
 *   Earth, Venus, the giants and the icy Galileans and Triton are drawn as
 *   they are.
 * - Below it a power toe draws albedo a as knee·(a/knee)^γ, so the gain is
 *   (a/knee)^(γ−1). It is continuous at the knee and strictly increasing, so a
 *   darker real surface always stays darker on screen.
 * - γ is set by the "dimmest named body" method the curve was first
 *   calibrated by (I1: the dimmest named world, the retired Fuxx map at
 *   0.0138, got exactly the 3× lift it already had): the dimmest mapped body
 *   or moon gets exactly 3×. On the real maps (2026-10-20) that is Ceres
 *   (0.016, geometric albedo 0.09), so γ = 1 + ln 3 / ln(0.016 / 0.0766) ≈ 0.30.
 *   It lifts Ceres 3×, the Moon ~2.4×, Mercury ~2.2×, Mars ~1.9×, Callisto
 *   ~1.8× and Titan ~1.6×. Phobos and Deimos (Task 14, darker still) take the
 *   same curve (3.3–3.6×) and keep their order.
 */

/** Earth's texel median: the identity starts here. */
export const DISPLAY_KNEE_LINEAR = bodyById("earth").texelMedianLinear;

/** The calibration point: the dimmest mapped body or moon, and the 3× lift the curve was first calibrated on. */
const TOE_CALIBRATION = {
  median: Math.min(...SOLAR_BODIES.map((b) => b.texelMedianLinear), ...SOLAR_MOONS.filter((m) => !m.shape).map((m) => m.texelMedianLinear)),
  gain: 3,
} as const;

/** The toe's exponent: displayAlbedoGain(TOE_CALIBRATION.median) is exactly TOE_CALIBRATION.gain. */
export const DISPLAY_TOE_GAMMA =
  1 + Math.log(TOE_CALIBRATION.gain) / Math.log(TOE_CALIBRATION.median / DISPLAY_KNEE_LINEAR);

/** The material-colour multiplier for a surface whose map's median linear luminance is `texelMedianLinear` (> 0). */
export function displayAlbedoGain(texelMedianLinear: number): number {
  if (texelMedianLinear >= DISPLAY_KNEE_LINEAR) return 1;
  return (texelMedianLinear / DISPLAY_KNEE_LINEAR) ** (DISPLAY_TOE_GAMMA - 1);
}
