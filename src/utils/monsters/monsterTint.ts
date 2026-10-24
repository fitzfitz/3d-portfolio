import * as THREE from "three";
import { mulberry32 } from "../mulberry32";

/**
 * Per-instance colours for the saucer alien (space monsters, Task 5). The
 * saucer's COLOR_0 is a zone mask (gen_saucer.py CONTRACT): R the skin, G the
 * spot cups, B the rim's paint band. The material multiplies each zone's
 * baked albedo by the matching colour here, so six saucers in one fight read
 * as six individuals from one model and one draw call per primitive.
 *
 * The skin and spots are already painted (wet green, pink) in the bake, so
 * their tints are light (sRGB lightness 0.70–0.80, saturation 0.40–0.65):
 * they swing the hue a little either way and never black a channel out. The
 * band is authored light neutral grey, so it takes a full paint colour.
 */

export interface SaucerTint { skin: THREE.Color; spot: THREE.Color; band: THREE.Color }

/** The skin's hue range (degrees, sRGB HSL): yellow-green to blue-green. */
export const SAUCER_SKIN_HUE = [95, 135] as const;
/** The spot cups' hue range (degrees, sRGB HSL): rose to raspberry pink. */
export const SAUCER_SPOT_HUE = [330, 355] as const;
/** The rim band's five paints (sRGB): brick red, mustard, teal, violet, tangerine. */
export const SAUCER_BAND_PAINTS = ["#b8352b", "#d9a520", "#1f8f8a", "#6c3fa0", "#e0702a"] as const;

/** The golden ratio's fraction: consecutive seeds land far apart in hue, never on one another. */
const GOLDEN = 0.6180339887498949;
const fract = (x: number) => x - Math.floor(x);

/**
 * The tint for a saucer's seed (its spawn index, say). Deterministic per
 * seed. Fills `out` when given (no allocation), else returns new colours;
 * call it once per spawn, not per frame.
 */
export function saucerTint(seed: number, out?: SaucerTint): SaucerTint {
  const t = out ?? { skin: new THREE.Color(), spot: new THREE.Color(), band: new THREE.Color() };
  const rnd = mulberry32(Math.floor(seed * 9973) ^ 0x5bd1e995);
  const [h0, h1] = SAUCER_SKIN_HUE;
  const skinHue = h0 + (h1 - h0) * fract(seed * GOLDEN + 0.13);
  t.skin.setHSL(skinHue / 360, 0.4 + 0.2 * rnd(), 0.7 + 0.08 * rnd(), THREE.SRGBColorSpace);
  const [s0, s1] = SAUCER_SPOT_HUE;
  t.spot.setHSL((s0 + (s1 - s0) * rnd()) / 360, 0.45 + 0.2 * rnd(), 0.72 + 0.08 * rnd(), THREE.SRGBColorSpace);
  const n = SAUCER_BAND_PAINTS.length;
  t.band.set(SAUCER_BAND_PAINTS[((Math.floor(seed) % n) + n) % n]);
  return t;
}
