/**
 * Toksvig's specular anti-aliasing (Toksvig 2005, "Mipmapping Normal Maps"),
 * for the probes' crinkled MLI blankets (FOLLOW-UPS, fixed 2026-10-22).
 *
 * Their sparkle is normal-map crinkle: small flat facets, each tilted its own
 * way. Past ~15 u the mips average many facets into one texel, and the
 * averaged normal is both flatter and shorter than unit. Normalised and lit
 * at the facets' own low roughness, it drew one flat mirror of the black sky
 * (v7 kept the blankets reading gold with metalness 0.88). The length is the
 * information: 1 − |n| grows with the spread of the normals averaged, so
 * σ² = (1 − |n|) / |n| adds to the lobe's width. In GGX's α = roughness²,
 * as Toksvig's Blinn–Phong power maps to it (α² ≈ 2 / (s + 2)):
 *
 *   α'² = α² + 2σ²,   roughness' = √α'.
 *
 * The probe's maps ship as lossy WebP, whose noise alone moves a mip-0
 * normal's length by about ±0.02 (measured: p10 0.94 – p90 1.02 on the
 * blankets, which also holds the creases' real averaging), so lengths within
 * TOKSVIG_NOISE of 1 count as unit: up close the facets keep their gloss.
 */

/** A normal this much short of unit length is the WebP's noise, not averaged detail. */
export const TOKSVIG_NOISE = 0.02;

/** The CPU mirror of TOKSVIG_FRAGMENT: roughness widened by a filtered normal of length `len`. */
export function toksvigRoughness(roughness: number, len: number): number {
  const l = Math.max(len, 1e-3);
  const variance = Math.max(1 - TOKSVIG_NOISE - l, 0) / l;
  const a = roughness * roughness;
  return Math.min(Math.sqrt(Math.sqrt(a * a + 2 * variance)), 1);
}

/**
 * Runs before `#include <lights_physical_fragment>` (which reads
 * roughnessFactor). Samples the normal map again at the same coordinates (the
 * same mip: a cache hit) for its unnormalised length.
 */
export const TOKSVIG_FRAGMENT = /* glsl */ `#ifdef USE_NORMALMAP_TANGENTSPACE
{
	float tkLen = max( length( texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0 ), 1e-3 );
	float tkVariance = max( ${(1 - TOKSVIG_NOISE).toFixed(3)} - tkLen, 0.0 ) / tkLen;
	float tkA = roughnessFactor * roughnessFactor;
	roughnessFactor = min( sqrt( sqrt( tkA * tkA + 2.0 * tkVariance ) ), 1.0 );
}
#endif`;
