import { bodyById } from "../data/solarSystem";

/**
 * One shared display curve for dark surfaces (docs/UNIVERSE-RULES.md P3, a
 * disclosed convention). Very dark surfaces are drawn brighter than their true
 * albedo so they stay visible; their relative order is real.
 *
 * The input is one statistic for every body: the median linear luminance of
 * its shipped map (`texelMedianLinear` in SOLAR_BODIES). The output
 * multiplies the body's material colour, a uniform, so no shader changes.
 *
 * - At and above the knee, Earth's own map median (~0.053), the gain is 1:
 *   Earth, Venus and the giants are drawn as they are.
 * - Below it a power toe draws albedo a as knee·(a/knee)^γ, so the gain is
 *   (a/knee)^(γ−1). It is continuous at the knee and strictly increasing, so a
 *   darker real surface always stays darker on screen.
 * - γ (~0.19) is set so a median of 0.0138 (the retired Fuxx map's, the
 *   curve's original calibration, I1) gets exactly 3×. Task 12 recalibrates
 *   γ by the "dimmest named body" method once the real maps land.
 */

/** Earth's texel median: the identity starts here. */
export const DISPLAY_KNEE_LINEAR = bodyById("earth").texelMedianLinear;

/** The calibration point: the retired Fuxx map's median and the 3× lift it had. */
const TOE_CALIBRATION = { median: 0.0138, gain: 3 } as const;

/** The toe's exponent: displayAlbedoGain(TOE_CALIBRATION.median) is exactly TOE_CALIBRATION.gain. */
export const DISPLAY_TOE_GAMMA =
  1 + Math.log(TOE_CALIBRATION.gain) / Math.log(TOE_CALIBRATION.median / DISPLAY_KNEE_LINEAR);

/** The material-colour multiplier for a surface whose map's median linear luminance is `texelMedianLinear` (> 0). */
export function displayAlbedoGain(texelMedianLinear: number): number {
  if (texelMedianLinear >= DISPLAY_KNEE_LINEAR) return 1;
  return (texelMedianLinear / DISPLAY_KNEE_LINEAR) ** (DISPLAY_TOE_GAMMA - 1);
}
