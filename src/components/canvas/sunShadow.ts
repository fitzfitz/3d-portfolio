import * as THREE from "three";
import { SUN_RADIUS } from "../../constants";
import type { Occluder } from "../../utils/sunOcclusion";

/**
 * Analytic sun shadows (F4). Bodies are spheres and the sun is a disc of
 * radius SUN_RADIUS at the origin, so the fraction of the sun a point can see
 * has a closed form: the same maths as `sunVisibility` in
 * src/utils/sunOcclusion.ts, which is its CPU reference. No shadow maps.
 *
 * `patchSunShadow` injects it into a built-in lit material's point-light loop
 * and scales only the sun's light by it, never the engine glow or the portal.
 *
 * - "fragment": coverage per fragment against `uOccluders` (for planets,
 *   whose discs a moon's shadow can cross part of).
 * - "object": one factor per material, `sunVis`, written on the CPU from
 *   `sunVisibility` (for moons and the ship, small enough to be all in or out).
 *
 * Patch the material instance that actually renders. `Material.clone()` does
 * not copy `onBeforeCompile`, `onBeforeRender` or `customProgramCacheKey`, so
 * a patched material's clone is unpatched: clone first, then patch the clone
 * (OrbitingMoon does this per moon). Patching is idempotent per instance; a
 * second call returns the first call's handle.
 */

/** Occluder slots in the shared uniform array. */
export const MAX_OCCLUDERS = 8;

/**
 * Shared by every patched material, so one write reaches all of them.
 * `uOccluders[i]` is xyz = world position, w = radius; only the first
 * `uOccluderCount` are read. `uSunView` is the sun's (the origin's) view-space
 * position. Patched materials refresh it themselves from the camera they are
 * rendered with (see `patchSunShadow`); `updateSunView` does it by hand.
 * In GLSL it is called `uSunShadowView`, so it never collides with the
 * `uniform vec3 uSunView;` that SpacePlanets' night-side patch declares.
 */
export const sunShadowUniforms = {
  uOccluders: { value: Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector4()) },
  uOccluderCount: { value: 0 },
  uSunView: { value: new THREE.Vector3() },
};

/**
 * Dev measurement hook: `countOverride` >= 0 replaces the occluder count the
 * frame loop writes, so the per-fragment cost can be timed with the shadows
 * off (0) against on (-1, the default). Reached through `__fitz` in dev.
 */
export const sunShadowDebug = { countOverride: -1 };

/**
 * The same slots on the CPU, for `sunVisibility` (object mode: moons and the
 * ship). Fixed objects, rewritten in place by `setOccluder`. Unused slots keep
 * r = 0, which covers nothing.
 */
export const occluders: readonly Occluder[] = Array.from({ length: MAX_OCCLUDERS }, () => ({ x: 0, y: 0, z: 0, r: 0 }));

/** Writes occluder slot `i` in place, GPU and CPU. Frame loops call this; it allocates nothing. */
export function setOccluder(i: number, x: number, y: number, z: number, r: number): void {
  sunShadowUniforms.uOccluders.value[i].set(x, y, z, r);
  const o = occluders[i];
  o.x = x; o.y = y; o.z = z; o.r = r;
}

/**
 * The origin through the camera's view matrix, written in place. That is
 * the translation column of matrixWorldInverse, which is exactly where three
 * puts a point light at the origin in view space.
 */
export function updateSunView(camera: THREE.Camera): void {
  const e = camera.matrixWorldInverse.elements;
  sunShadowUniforms.uSunView.value.set(e[12], e[13], e[14]);
}

/**
 * The coverage maths on its own, shared by the lit-material patch below and
 * by shaders that are not lit materials (Ruangrapi's ring, guideLine.ts):
 * the slot uniforms, and two functions mirroring `sunVisibility` term for
 * term. The sun is a disc of radius SUN_SHADOW_RADIUS at the origin; points
 * are in world space.
 *
 * - `sunShadowCoverFrom( p, u, sunDist, sunAng, o )`: the fraction of the
 *   sun that occluder `o` (xyz centre, w radius) hides from p, given the sun's
 *   direction `u`, distance and angular radius from p (computed once per
 *   point by the caller).
 * - `sunShadowVisibility( p, o )`: the visible fraction against `o` alone.
 */
export const SUN_SHADOW_CORE_GLSL = /* glsl */ `
#define SUN_SHADOW_MAX ${MAX_OCCLUDERS}
#define SUN_SHADOW_RADIUS ${SUN_RADIUS.toFixed(1)}
uniform vec4 uOccluders[ SUN_SHADOW_MAX ];
uniform int uOccluderCount;

float sunShadowCoverFrom( vec3 p, vec3 u, float sunDist, float sunAng, vec4 o ) {
	vec3 b = o.xyz - p;
	float r = o.w;
	float d = length( b );
	if ( d >= sunDist || d == 0.0 ) return 0.0;
	float c = dot( b, u ) / d;
	if ( c <= 0.0 ) return 0.0; // on the far side of the point from the sun
	if ( d <= r ) return 1.0; // inside the body
	// Early out before the trig: an occluder farther off the sun line than
	// its radius plus the sun's own width at its distance hides nothing.
	// Exact, never an approximation: sin( bodyAng + sunAng ) <= r / d +
	// tan( sunAng ), so this only skips occluders whose cover is 0.
	float sinSun = SUN_SHADOW_RADIUS / sunDist;
	float tanSun = sinSun * inversesqrt( 1.0 - sinSun * sinSun );
	if ( d * sqrt( max( 0.0, 1.0 - c * c ) ) > r + d * tanSun ) return 0.0;
	float bodyAng = asin( r / d );
	float sep = acos( min( 1.0, c ) );
	float cover = clamp( ( bodyAng + sunAng - sep ) / ( 2.0 * sunAng ), 0.0, 1.0 );
	if ( bodyAng < sunAng ) {
		float share = bodyAng / sunAng;
		cover = min( cover, share * share );
	}
	return cover;
}

float sunShadowVisibility( vec3 p, vec4 o ) {
	float sunDist = length( p );
	if ( sunDist <= SUN_SHADOW_RADIUS ) return 1.0;
	return 1.0 - sunShadowCoverFrom( p, -p / sunDist, sunDist, asin( SUN_SHADOW_RADIUS / sunDist ), o );
}
`;

/**
 * The fragment-shader chunk for lit materials, inserted after
 * `#include <common>`: the core above, plus the sun-light test and the
 * all-occluder loop. It needs `SUN_SHADOW_SELF` (-1 for none) defined before
 * it. `sunShadowCoverage` returns the visible fraction of the sun (1 clear,
 * 0 hidden), mirroring `sunVisibility`.
 */
export const SUN_SHADOW_GLSL = /* glsl */ `${SUN_SHADOW_CORE_GLSL}
uniform vec3 uSunShadowView;

// The sun's point light: the one three placed at the origin's view position.
bool isSunLight( vec3 lightViewPos ) {
	vec3 d = lightViewPos - uSunShadowView;
	return dot( d, d ) < 1e-4;
}

float sunShadowCoverage( vec3 p ) {
	float sunDist = length( p );
	if ( sunDist <= SUN_SHADOW_RADIUS ) return 1.0;
	vec3 u = -p / sunDist;
	float sunAng = asin( SUN_SHADOW_RADIUS / sunDist );
	float visible = 1.0;
	for ( int k = 0; k < SUN_SHADOW_MAX; k ++ ) {
		if ( k >= uOccluderCount ) break;
		if ( k == SUN_SHADOW_SELF ) continue;
		visible *= 1.0 - sunShadowCoverFrom( p, u, sunDist, sunAng, uOccluders[ k ] );
	}
	return visible;
}

// World position from view space. viewMatrix is rigid, so its inverse is the
// transposed rotation applied after removing the translation.
vec3 sunShadowWorld( vec3 viewPos ) {
	return ( viewPos - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
}
`;

/** Where the gate goes: right after three fills `directLight` for point light i. */
const POINT_LIGHT_ANCHOR = "getPointLightInfo( pointLight, geometryPosition, directLight );";

/** Inside the unrolled loop: no `[ i ]`, no braces that end the loop body. */
const GATE = {
  fragment:
    "if ( isSunLight( pointLight.position ) ) directLight.color *= sunShadowCoverage( sunShadowWorld( geometryPosition ) );",
  object: "if ( isSunLight( pointLight.position ) ) directLight.color *= uSunVis;",
} as const;

type Mode = keyof typeof GATE;

const defaultCacheKey = THREE.Material.prototype.customProgramCacheKey;

type Handle = { sunVis?: { value: number } };

/**
 * Materials already patched, with the handle they were given. A second patch
 * would inject the header and the gate twice, which does not compile.
 */
const patched = new WeakMap<THREE.Material, Handle>();

/**
 * Patches `material` so the sun's light is scaled by its visibility. Composes
 * with any `onBeforeCompile`, `onBeforeRender` and `customProgramCacheKey`
 * the material already has. Patch a material once.
 *
 * `selfIndex` (fragment mode) is the occluder slot holding the body this
 * material is drawn on; it is skipped, as the body's own night side is already
 * dark from N·L. Returns `sunVis` in object mode: the CPU writes the visible
 * fraction there (it starts at 1, a clear sun). It belongs to this material,
 * so objects sharing a material share it; pass `opts.sunVis` to make several
 * materials (the ship's hull parts) read one shared value instead.
 *
 * Patching the same material again returns the existing handle unchanged.
 */
export function patchSunShadow(
  material: THREE.Material,
  mode: Mode,
  opts?: { selfIndex?: number; sunVis?: { value: number } },
): Handle {
  const existing = patched.get(material);
  if (existing) return existing;
  const selfIndex = mode === "fragment" ? (opts?.selfIndex ?? -1) : -1;
  const sunVis = mode === "object" ? (opts?.sunVis ?? { value: 1 }) : undefined;

  const prevCompile = material.onBeforeCompile;
  const prevRender = material.onBeforeRender;
  const prevKeyFn = material.customProgramCacheKey;
  // The default key is the onBeforeCompile source, which is about to become
  // ours; take the previous one's now so its variants stay distinct.
  const prevKey =
    prevKeyFn === defaultCacheKey ? () => prevCompile.toString() : () => prevKeyFn.call(material);

  material.onBeforeCompile = function (shader, renderer) {
    prevCompile.call(this, shader, renderer);

    shader.uniforms.uOccluders = sunShadowUniforms.uOccluders;
    shader.uniforms.uOccluderCount = sunShadowUniforms.uOccluderCount;
    shader.uniforms.uSunShadowView = sunShadowUniforms.uSunView;
    if (sunVis) shader.uniforms.uSunVis = sunVis;

    const header =
      `#define SUN_SHADOW_SELF ${selfIndex}\n` + SUN_SHADOW_GLSL + (sunVis ? "uniform float uSunVis;\n" : "");
    const lights = THREE.ShaderChunk.lights_fragment_begin.replace(
      POINT_LIGHT_ANCHOR,
      `${POINT_LIGHT_ANCHOR}\n\t\t${GATE[mode]}`,
    );
    if (lights === THREE.ShaderChunk.lights_fragment_begin || !shader.fragmentShader.includes("#include <lights_fragment_begin>")) {
      console.warn("patchSunShadow: point-light loop not found; sun shadows are off for", material.type);
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${header}`)
      .replace("#include <lights_fragment_begin>", lights);
  };

  // Refresh the sun's view position from the camera this draw uses, after
  // three has updated its matrices, so the gate matches the light exactly.
  material.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
    prevRender.call(this, renderer, scene, camera, geometry, object, group);
    updateSunView(camera);
  };

  material.customProgramCacheKey = () => `${prevKey()}|sunShadow:${mode}:${selfIndex}`;

  const handle: Handle = sunVis ? { sunVis } : {};
  patched.set(material, handle);
  return handle;
}
