import * as THREE from "three";

/**
 * Earth's sea as water, its land as every other body's matte (FOLLOW-UPS,
 * "Earth's ocean sheen"; fixed 2026-10-22). Before this the whole planet was
 * one MeshStandardMaterial at roughness 0.5: three's dielectric F0 of 0.04 is
 * twice water's 0.02, and the sea's wind-roughened gloss lay on the land and
 * the ice too, so a broad grey sheen sat over the lit disc and greyed the
 * blue (taking it out lifted a cloudless disc's B/G 1.35 → 1.63).
 *
 * The ocean mask rides in the Earth map's alpha (process_body_maps.mjs
 * oceanMask: 1 water, 0 land and ice), so it costs no texture and no fetch:
 * three already samples the map as `sampledDiffuseColor`. The material is a
 * MeshPhysicalMaterial at water's ior; this patch mixes, per texel:
 *  - roughness: SEA_ROUGHNESS on water, LAND_ROUGHNESS (every other body's)
 *    on land. Cox–Munk's mean-square slope is 0.003 + 0.00512 U (U the wind
 *    in m/s): 0.4 is GGX α 0.16, the sea at ~4.5 m/s, a little calmer than
 *    the ~7 m/s mean (0.45). GGX's long tail spreads a lobe wider than
 *    Cox–Munk's near-Gaussian one, and 0.45–0.5 drew a broad grey haze over
 *    the disc rather than the compact glint seen from orbit;
 *  - ior: the material's (water, F0 0.02) on water, 1.5 (three's standard
 *    dielectric, F0 0.04) on land, so the land draws exactly as before but
 *    for its roughness.
 * The sun's glint is then the sea's own GGX lobe at water's F0; F90 stays 1
 * (specularIntensity 1), so the limb keeps its Fresnel.
 *
 * One more program than before: Earth leaves the night-lights program it
 * shared with Io (a physical material and this hook), compiled at load by
 * ShaderWarmup like every other (docs/PERF-BUDGETS.md).
 */

/** Pure water's index of refraction (visible light). */
export const WATER_IOR = 1.333;
/** The open sea's roughness: Cox–Munk at ~4.5 m/s (see above). */
export const SEA_ROUGHNESS = 0.4;
/** Land and ice: the matte every other body wears (SolarBodies). */
export const LAND_ROUGHNESS = 0.95;
/** three's dielectric default: ior 1.5, F0 0.04. */
const LAND_IOR = 1.5;

/** Normal-incidence Fresnel reflectance of a dielectric of index `ior` in vacuum. */
export function dielectricF0(ior: number): number {
  return ((ior - 1) / (ior + 1)) ** 2;
}

/** The CPU mirror of the patch: roughness and F0 at a texel whose map alpha (water fraction) is `ocean`. */
export function oceanSurface(ocean: number): { roughness: number; f0: number } {
  const mix = (a: number, b: number) => a + (b - a) * ocean;
  return { roughness: mix(LAND_ROUGHNESS, SEA_ROUGHNESS), f0: dielectricF0(mix(LAND_IOR, WATER_IOR)) };
}

const f = (x: number) => x.toFixed(3);
const ROUGHNESS_FRAGMENT = /* glsl */ `float oceanMask = sampledDiffuseColor.a;
float roughnessFactor = mix( ${f(LAND_ROUGHNESS)}, ${f(SEA_ROUGHNESS)}, oceanMask );`;
const IOR_ANCHOR = "material.ior = ior;";
const LIGHTS_PHYSICAL_FRAGMENT = THREE.ShaderChunk.lights_physical_fragment.replace(
  IOR_ANCHOR, `material.ior = mix( ${f(LAND_IOR)}, ior, oceanMask );`);

const defaultCacheKey = THREE.Material.prototype.customProgramCacheKey;

/**
 * Patches Earth's surface material (a MeshPhysicalMaterial at WATER_IOR whose
 * map carries the ocean mask in alpha). Composes over an existing compile
 * hook (patchNightGlow's); call before patchSunShadow, which composes over
 * this one.
 */
export function patchOceanGloss(material: THREE.MeshPhysicalMaterial): void {
  const prevCompile = material.onBeforeCompile;
  const prevKeyFn = material.customProgramCacheKey;
  const prevKey = prevKeyFn === defaultCacheKey ? () => prevCompile.toString() : () => prevKeyFn.call(material);
  material.onBeforeCompile = function (shader, renderer) {
    prevCompile.call(this, shader, renderer);
    const fs = shader.fragmentShader;
    if (!fs.includes("#include <roughnessmap_fragment>") || !fs.includes("#include <lights_physical_fragment>")
      || LIGHTS_PHYSICAL_FRAGMENT === THREE.ShaderChunk.lights_physical_fragment) {
      console.warn("patchOceanGloss: anchors not found; Earth's sea keeps one roughness");
      return;
    }
    shader.fragmentShader = fs
      .replace("#include <roughnessmap_fragment>", ROUGHNESS_FRAGMENT)
      .replace("#include <lights_physical_fragment>", LIGHTS_PHYSICAL_FRAGMENT);
  };
  material.customProgramCacheKey = () => `${prevKey()}|ocean`;
}
