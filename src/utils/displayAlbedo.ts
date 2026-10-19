import { PLANET_PROPS } from "../constants";

/**
 * One shared display curve for dark surfaces (docs/UNIVERSE-RULES.md P3, a
 * disclosed convention). Very dark surfaces are drawn brighter than their true
 * albedo so they stay visible; their relative order is real.
 *
 * The input is one statistic for every body: the median linear luminance of
 * its shipped map (`texelMedianLinear` in PLANET_PROPS and WORLDS). The output
 * multiplies the body's material colour, a uniform, so no shader changes.
 *
 * - At and above the knee, Ruangrapi's own median (~0.053), the gain is 1:
 *   Ruangrapi, Portfolio and the giants are drawn as they are.
 * - Below it a power toe draws albedo a as knee·(a/knee)^γ, so the gain is
 *   (a/knee)^(γ−1). It is continuous at the knee and strictly increasing, so a
 *   darker real surface always stays darker on screen.
 * - γ (~0.19) is set so Fuxx's median (~0.014) gets exactly 3×, the lift it
 *   already had (I1): the one special case became an instance of the rule,
 *   and Fuxx looks as before.
 */

/** Ruangrapi's texel median: the identity starts here. */
export const DISPLAY_KNEE_LINEAR = PLANET_PROPS.ruangrapi.texelMedianLinear;

/** Fuxx's gain under the curve: its old FUXX_ALBEDO_LIFT, the calibration point. */
const FUXX_GAIN = 3;

/** The toe's exponent: displayAlbedoGain(Fuxx's median) is exactly FUXX_GAIN. */
export const DISPLAY_TOE_GAMMA =
  1 + Math.log(FUXX_GAIN) / Math.log(PLANET_PROPS.fuxx.texelMedianLinear / DISPLAY_KNEE_LINEAR);

/** The material-colour multiplier for a surface whose map's median linear luminance is `texelMedianLinear` (> 0). */
export function displayAlbedoGain(texelMedianLinear: number): number {
  if (texelMedianLinear >= DISPLAY_KNEE_LINEAR) return 1;
  return (texelMedianLinear / DISPLAY_KNEE_LINEAR) ** (DISPLAY_TOE_GAMMA - 1);
}
