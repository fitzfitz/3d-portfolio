import * as THREE from "three";
import { planets, SUN_RADIUS } from "../../constants";
import { MOONS } from "../../data/moons";
import { WORLDS, type WorldId } from "../../data/worlds";
import { RING_TAU_MAX } from "../../utils/ringOptics";
import { sunVisibility, type Occluder } from "../../utils/sunOcclusion";

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
 *   whose discs a moon's shadow can cross part of). The loop skips the body
 *   the fragment lies on by distance, so no program depends on a body's slot.
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
export const MAX_OCCLUDERS = 16;

/**
 * The worlds that hold a GPU slot, in WORLDS order. A body only shadows
 * receivers farther from the sun than itself, so the outermost world (w-blue)
 * needs none; it still shadows the ship and the sun's glare on the CPU.
 */
const OUTERMOST_WORLD = WORLDS.reduce((a, w) => (w.orbit.radius > a.orbit.radius ? w : a));
const SLOTTED_WORLDS: readonly WorldId[] = WORLDS.filter((w) => w !== OUTERMOST_WORLD).map((w) => w.id);

/**
 * Fixed occluder slots (F4, docs/UNIVERSE-RULES.md L20): the planets in
 * `planets` order, the moons in MOONS order, then the worlds in WORLDS order
 * less the outermost (w-rock 8, w-ringed 9, w-tilted 10, w-dwarf 11). Fixed,
 * never a per-frame nearest-N choice, which would make shadows pop.
 */
export const OCCLUDER_SLOTS = {
  planets: { first: 0, count: planets.length },
  moons: { first: planets.length, count: MOONS.length },
  worlds: { first: planets.length + MOONS.length, count: SLOTTED_WORLDS.length },
} as const;

/** World `id`'s occluder slot, or -1 for the outermost world, which has none. */
export function worldSlot(id: WorldId): number {
  const i = SLOTTED_WORLDS.indexOf(id);
  return i < 0 ? -1 : OCCLUDER_SLOTS.worlds.first + i;
}

/**
 * The self-skip, in radii: an occluder whose centre is closer to the point
 * than this is the body the point lies on (or its cloud shell, at 1.03 R).
 * Its night side is already dark from N·L, and without the skip its surface
 * would sit in its own umbra.
 */
export const SELF_SKIP_RADII = 1.05;

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
#define SUN_SHADOW_SELF_SKIP ${SELF_SKIP_RADII.toFixed(2)}
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
 * all-occluder loop. `sunShadowCoverage` returns the visible fraction of the
 * sun (1 clear, 0 hidden); its CPU mirror is `sunShadowCoverage` below.
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
		if ( length( uOccluders[ k ].xyz - p ) < SUN_SHADOW_SELF_SKIP * uOccluders[ k ].w ) continue;
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

/**
 * The CPU mirror of the GLSL `sunShadowCoverage` loop, self-skip included:
 * the visible fraction of the sun at `p` against `bodies`.
 */
export function sunShadowCoverage(p: { x: number; y: number; z: number }, bodies: readonly Occluder[]): number {
  return sunVisibility(p, bodies, SUN_RADIUS, SELF_SKIP_RADII);
}

/**
 * The rings' shadow on their planet (L20), for `patchSunShadow`'s `ringShadow`
 * option: the ray from the fragment toward the sun meets the ring plane
 * (through the planet's centre, normal `uRingShadowNormal`, the spin axis)
 * at radius r; the sunlight let through there is exp(−τ(r)/μ₀), μ₀ =
 * |sin(the sun's elevation above the ring plane)| (ringOptics.ts
 * ringTransmission). It has no viewer term, so it does not move with the
 * camera. τ comes from the ring strip's alpha (τ / RING_TAU_MAX).
 *
 * P3 artifact (docs/UNIVERSE-RULES.md L20): the transmission is averaged over
 * the drawn sun's disc, whose rays cross the ring plane over a radial width
 * of about s · tan(sunAng) / μ₀ (s the distance to the plane). The drawn sun
 * is ~45× the real one, so the Cassini division's shadow blurs; the real
 * shadow is sharp.
 *
 * The planet's centre is the mesh's origin, passed from the vertex shader
 * (`vRingShadowCentre`), so no uniform has to follow the orbit.
 */
const RING_SHADOW_GLSL = /* glsl */ `
#define RING_SHADOW_TAU_MAX ${RING_TAU_MAX.toFixed(1)}
uniform vec3 uRingShadowNormal;
uniform vec2 uRingShadowRadii;
uniform sampler2D uRingShadowMap;
varying vec3 vRingShadowCentre;

float ringShadowTau( float r ) {
	// Clamp-to-edge: the strip's end texels hold τ = 0 (inside C, outside A).
	return texture2D( uRingShadowMap, vec2( ( r - uRingShadowRadii.x ) / ( uRingShadowRadii.y - uRingShadowRadii.x ), 0.5 ) ).a * RING_SHADOW_TAU_MAX;
}

float ringShadowTransmission( vec3 p ) {
	float sunDist = length( p );
	if ( sunDist <= SUN_SHADOW_RADIUS ) return 1.0;
	vec3 u = -p / sunDist;
	vec3 n = normalize( uRingShadowNormal );
	float un = dot( u, n );
	float mu0 = abs( un );
	if ( mu0 < 1e-4 ) return 1.0; // the sun in the ring plane: the rings are edge-on to it
	float s = dot( vRingShadowCentre - p, n ) / un;
	if ( s <= 0.0 || s >= sunDist ) return 1.0; // the plane is behind the point, or past the sun
	float r = length( p + s * u - vRingShadowCentre );
	// The sun's disc spread over the plane (the P3 blur), sampled radially:
	// five taps weighted by the disc's chord.
	float w = s * tan( asin( SUN_SHADOW_RADIUS / sunDist ) ) / max( mu0, 0.05 );
	float t = 0.0;
	t += 0.6 * exp( -ringShadowTau( r - 0.8 * w ) / mu0 );
	t += 0.9165 * exp( -ringShadowTau( r - 0.4 * w ) / mu0 );
	t += 1.0 * exp( -ringShadowTau( r ) / mu0 );
	t += 0.9165 * exp( -ringShadowTau( r + 0.4 * w ) / mu0 );
	t += 0.6 * exp( -ringShadowTau( r + 0.8 * w ) / mu0 );
	return t / 4.033;
}

float sunShadowRingGate( vec3 p ) {
	return sunShadowCoverage( p ) * ringShadowTransmission( p );
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
const RING_GATE =
  "if ( isSunLight( pointLight.position ) ) directLight.color *= sunShadowRingGate( sunShadowWorld( geometryPosition ) );";

type Mode = keyof typeof GATE;

/**
 * The ringed giant's rings, for their shadow on it (`RING_SHADOW_GLSL`).
 * `normal` is the ring plane's normal (the spin axis), a uniform the frame
 * loop rewrites in place; `inner`/`outer` are the ring's radii (u); `map` is
 * the ring strip.
 */
export interface RingShadow {
  normal: { value: THREE.Vector3 };
  inner: number;
  outer: number;
  map: THREE.Texture;
}

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
 * Fragment mode needs no slot: the loop skips the body the fragment lies on
 * (`SELF_SKIP_RADII`). Returns `sunVis` in object mode: the CPU writes the visible
 * fraction there (it starts at 1, a clear sun). It belongs to this material,
 * so objects sharing a material share it; pass `opts.sunVis` to make several
 * materials (the ship's hull parts) read one shared value instead.
 *
 * `opts.ringShadow` (fragment mode, the ringed giant only) also lets the
 * sunlight through its rings (`RING_SHADOW_GLSL`): one more program, its own.
 *
 * Patching the same material again returns the existing handle unchanged.
 */
export function patchSunShadow(
  material: THREE.Material,
  mode: Mode,
  opts?: { sunVis?: { value: number }; ringShadow?: RingShadow },
): Handle {
  const existing = patched.get(material);
  if (existing) return existing;
  const sunVis = mode === "object" ? (opts?.sunVis ?? { value: 1 }) : undefined;
  const ring = mode === "fragment" ? opts?.ringShadow : undefined;

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
    if (ring) {
      shader.uniforms.uRingShadowNormal = ring.normal;
      shader.uniforms.uRingShadowRadii = { value: new THREE.Vector2(ring.inner, ring.outer) };
      shader.uniforms.uRingShadowMap = { value: ring.map };
    }

    const header = SUN_SHADOW_GLSL + (sunVis ? "uniform float uSunVis;\n" : "") + (ring ? RING_SHADOW_GLSL : "");
    const lights = THREE.ShaderChunk.lights_fragment_begin.replace(
      POINT_LIGHT_ANCHOR,
      `${POINT_LIGHT_ANCHOR}\n\t\t${ring ? RING_GATE : GATE[mode]}`,
    );
    if (lights === THREE.ShaderChunk.lights_fragment_begin || !shader.fragmentShader.includes("#include <lights_fragment_begin>")) {
      console.warn("patchSunShadow: point-light loop not found; sun shadows are off for", material.type);
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${header}`)
      .replace("#include <lights_fragment_begin>", lights);
    if (ring) {
      // The planet's centre: the mesh's own origin in world space.
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRingShadowCentre;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvRingShadowCentre = modelMatrix[ 3 ].xyz;");
    }
  };

  // Refresh the sun's view position from the camera this draw uses, after
  // three has updated its matrices, so the gate matches the light exactly.
  material.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
    prevRender.call(this, renderer, scene, camera, geometry, object, group);
    updateSunView(camera);
  };

  material.customProgramCacheKey = () => `${prevKey()}|sunShadow:${mode}${ring ? ":ring" : ""}`;

  const handle: Handle = sunVis ? { sunVis } : {};
  patched.set(material, handle);
  return handle;
}
