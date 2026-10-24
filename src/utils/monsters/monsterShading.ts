import * as THREE from "three";
import { FOCAL_PX } from "../sphereLod";

/**
 * Shading shared by both space monsters (Task 5): the shader-patch helper,
 * the two uniforms every monster material shares, the common vertex maths,
 * the translucent-skin term and the shell fur (one chunk each, used by the
 * saucer's and the tardigrade's materials alike), and the TypeScript mirrors
 * of the fur's pure maths.
 *
 * Neither model has a skeleton: every move is played per instance in the
 * vertex shader from the glTF's _MOTION/_FUR channels (renamed below) and a
 * few per-instance attributes. Shells and LOD levels are attributes and
 * InstancedMesh counts, never defines, so they add no shader program.
 */

/**
 * The uniforms every monster material shares (the same objects in each
 * program). The caller sets `uTime` (seconds; keep it running under reduced
 * motion) and `uMotion` (1, or 0 under reduced motion). Reduced motion (R20)
 * stops the decorative motion only: the idle wave, breathing, sway, paddle,
 * the drips' and the drool's sway, the fur's flow and the glow pulses all
 * scale by `uMotion`. The state poses (look, aim, fire, hit, blink, defeat,
 * curl, charge, recoil) come from the per-instance attributes and still
 * apply, held without oscillation: a player must still see where a monster
 * aims. The caller holds each pose still under reduced motion too (no timed
 * blink, no pulsing fire).
 */
export const MONSTER_UNIFORMS = {
  uTime: { value: 0 },
  uMotion: { value: 1 },
};

/**
 * Inserts `code` at a three.js `#include` anchor, after it, before it or in
 * its place. Throws when the anchor is missing: a three.js upgrade that
 * renames a chunk must fail loudly, not compile a monster that silently
 * stands still. Each patch leaves a `// monster patch: <anchor>` marker (the
 * tests count them).
 */
export function injectShader(src: string, anchor: string, code: string, mode: "after" | "before" | "replace"): string {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`monster shader: anchor "${anchor}" missing (three.js upgrade?)`);
  const marker = `// monster patch: ${anchor}`;
  const patched = mode === "after" ? `${anchor}\n${marker}\n${code}`
    : mode === "before" ? `${marker}\n${code}\n${anchor}`
      : `${marker}\n${code}`;
  return src.slice(0, at) + patched + src.slice(at + anchor.length);
}

/** Replaces every `find` in a three.js chunk's source, throwing when there is none (as injectShader). */
export function replaceInChunk(chunk: string, find: string, by: string): string {
  if (!chunk.includes(find)) throw new Error(`monster shader: anchor "${find}" missing in a three.js chunk (three.js upgrade?)`);
  return chunk.split(find).join(by);
}

/** A GLSL float literal (always with a decimal point). */
export const glslFloat = (x: number): string => x.toFixed(5);
/** A GLSL vecN literal. */
export const glslVec = (v: readonly number[]): string => `vec${v.length}(${v.map(glslFloat).join(", ")})`;

// ------------------------------------------------------------- vertex ----

/**
 * After `#include <common>` in every patched monster vertex shader: the
 * glTF channels (GLTFLoader names COLOR_0 `color` and _MOTION `_motion`;
 * prepareMonsterGeometry renames them), the shared uniforms and the
 * rotation helpers. COLOR_0 is a zone mask (R, G, B each 0 or 1), never a
 * colour, so the materials switch `vertexColors` off and read it here.
 */
export const MONSTER_VERTEX_COMMON = /* glsl */ `
attribute vec3 monsterMask;
attribute vec4 monsterMotion;
uniform float uTime;
uniform float uMotion;
varying float vMonsterThin;
#define MONSTER_TAU 6.283185307
int monsterPart( float slot ) { return int( floor( slot * 16.0 ) ); }
vec3 monsterRotX( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x, v.y * c - v.z * s, v.y * s + v.z * c ); }
vec3 monsterRotY( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x * c + v.z * s, v.y, - v.x * s + v.z * c ); }
vec3 monsterRotZ( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x * c - v.y * s, v.x * s + v.y * c, v.z ); }
vec3 monsterRotate( vec3 v, vec3 axis, float a ) {
  float c = cos( a ), s = sin( a );
  return v * c + cross( axis, v ) * s + axis * dot( axis, v ) * ( 1.0 - c );
}
`;

/**
 * The vertex main() patches: at `#include <beginnormal_vertex>` (three has
 * just set objectNormal; it transforms it by the instance matrix next) the
 * material's deform moves the rest position and its normal, then (fur only)
 * the shell offset; at `#include <begin_vertex>` the moved position becomes
 * three's `transformed`.
 */
export function monsterVertexMain(deform: string, after = ""): { beginnormal: string; begin: string } {
  return {
    beginnormal: `vec3 monsterPos = vec3( position );
${deform}
objectNormal = normalize( objectNormal );
vMonsterThin = monsterMotion.w;
${after}`,
    begin: "transformed = monsterPos;",
  };
}

// ------------------------------------------------- translucent skin ------

/** How far the wrap term reaches past the terminator (0 none, 1 all round). */
export const SKIN_WRAP = 0.5;
/** The light through the thinnest parts toward a viewer facing the light. */
export const SKIN_BACKLIGHT = 0.6;

/**
 * After `#include <common>` in a monster fragment shader: the subsurface
 * stand-in's constants and its scalar term. Wrap lighting carries a warm
 * share of the light past the terminator, and light from behind shows
 * through, both weighted by _MOTION.w (thinness): tentacle tips, lids,
 * teeth, slime, the tardigrade's legs and folds.
 */
export function translucencyHeader(tint: readonly number[], amount: number): string {
  return /* glsl */ `
varying float vMonsterThin;
const vec3 MONSTER_SSS_TINT = ${glslVec(tint.map((c) => c * amount))};
float monsterTranslucency( float ndl, float vdl ) {
  float wrap = saturate( ( ndl + ${glslFloat(SKIN_WRAP)} ) / ${glslFloat(1 + SKIN_WRAP)} ) - saturate( ndl );
  float through = pow( saturate( vdl ), 4.0 ) * saturate( 0.25 - ndl ) * ${glslFloat(SKIN_BACKLIGHT)};
  return wrap + through;
}
`;
}

/**
 * After `#include <lights_fragment_begin>` (three has lit the direct lights
 * into reflectedLight): the same lights again, through the translucent
 * term, into the diffuse. The Sun is a point light; a directional light
 * (the lab's, say) counts too.
 */
export const TRANSLUCENCY_FRAGMENT = /* glsl */ `{
  vec3 monsterWrap = vec3( 0.0 );
  #if ( NUM_POINT_LIGHTS > 0 )
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
    getPointLightInfo( pointLights[ i ], geometryPosition, directLight );
    monsterWrap += directLight.color * monsterTranslucency( dot( geometryNormal, directLight.direction ), dot( geometryViewDir, - directLight.direction ) );
  }
  #pragma unroll_loop_end
  #endif
  #if ( NUM_DIR_LIGHTS > 0 )
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
    getDirectionalLightInfo( directionalLights[ i ], directLight );
    monsterWrap += directLight.color * monsterTranslucency( dot( geometryNormal, directLight.direction ), dot( geometryViewDir, - directLight.direction ) );
  }
  #pragma unroll_loop_end
  #endif
  reflectedLight.directDiffuse += vMonsterThin * MONSTER_SSS_TINT * monsterWrap * BRDF_Lambert( material.diffuseColor );
}`;

// ---------------------------------------------------------- shell fur ----

/** Fur droop toward the model's -Y at the tips, as a share of the fur's length. */
export const FUR_DROOP = 0.35;
/** The tips' slow flow (sway), as a share of the fur's length; 0 under reduced motion. */
export const FUR_FLOW = 0.12;

/**
 * How far a shell's tip can sit from its root, at most: the full length out
 * along the normal plus the droop and the flow (furVertexHeader: n·h + (droop
 * + flow)·h², h ≤ 1, |flow| ≤ FUR_FLOW·√2). For the bounds margins.
 */
export function furReach(furMaxLength: number): number {
  return furMaxLength * (1 + Math.hypot(FUR_DROOP, FUR_FLOW * Math.SQRT2));
}
/** Wet fur clumps: the strand threshold rises this much faster at wetness 1. */
export const FUR_CLUMP = 0.35;
/** Wet tips darken by up to this share. */
export const FUR_WET_DARKEN = 0.35;
/** The undercoat's shade at the root (shell height 0), lifting to 1 at the tips. */
export const FUR_ROOT_SHADE = 0.7;

/**
 * After `#include <common>` in a fur vertex shader. The fur primitive is
 * drawn once per shell (InstancedMesh count = monsters × shells): each
 * instance carries `monsterShell` = (shell index s, this monster's shell
 * count n). Shell s sits s/n of the fur's length out along the normal,
 * drooping and flowing at the tips; the cards (COLOR_0 R) draw only at shell
 * 0, and shells at or past n collapse to a point.
 */
export function furVertexHeader(furMaxLength: number): string {
  return /* glsl */ `
attribute vec2 monsterFur;
attribute vec2 monsterShell;
varying vec4 vMonsterFur;
const float MONSTER_FUR_LENGTH = ${glslFloat(furMaxLength)};
void monsterFurShell( inout vec3 p, vec3 n, float phase ) {
  float card = step( 0.5, monsterMask.r );
  float shells = max( monsterShell.y, 1.0 );
  float h = monsterShell.x / shells;
  float len = monsterFur.x * MONSTER_FUR_LENGTH * ( 1.0 - card );
  vec3 flow = vec3( sin( uTime * 1.7 + phase + p.x * 4.0 ), 0.0, cos( uTime * 1.3 + phase + p.z * 4.0 ) ) * ( ${glslFloat(FUR_FLOW)} * uMotion );
  vec3 droop = vec3( 0.0, - ${glslFloat(FUR_DROOP)}, 0.0 ) + flow;
  p += ( n * h + droop * h * h ) * len;
  if ( monsterShell.x > shells - 0.5 || ( card > 0.5 && monsterShell.x > 0.5 ) ) p = vec3( 0.0 );
  float wet = monsterFur.y;
  vMonsterFur = vec4( card, h, wet, card > 0.5 ? monsterFur.x : h * ( 1.0 + ${glslFloat(FUR_CLUMP)} * wet ) );
}
`;
}

/**
 * After `#include <common>` in a fur fragment shader: the atlas remap. The
 * base and its shells sample only the atlas's shell half (rig
 * furAtlas.shells, [u0, v0, u1, v1]), wrapping the base's unbounded
 * (tiling) coordinates with fract, inset by the current mip's footprint so
 * filtering never bleeds across u = 0.5 or the wrap; gradients come from the
 * unwrapped coordinates (textureGrad), so the fract seam keeps its mip. The
 * cards' coordinates already point into the lock half, so they pass as is.
 * vMonsterFur = (card, shell height, wetness, alpha threshold).
 */
export function furFragmentHeader(shellsRect: readonly number[]): string {
  return /* glsl */ `
varying vec4 vMonsterFur;
const vec4 MONSTER_FUR_RECT = ${glslVec(shellsRect)};
vec2 monsterFurAtlasUv( vec2 uv, vec2 texels, vec2 gx, vec2 gy ) {
  vec2 size = MONSTER_FUR_RECT.zw - MONSTER_FUR_RECT.xy;
  float footprint = max( max( length( gx * texels ), length( gy * texels ) ), 1.0 );
  vec2 inset = footprint / texels;
  return MONSTER_FUR_RECT.xy + inset + fract( uv ) * ( size - 2.0 * inset );
}
vec4 monsterFurTexture( sampler2D tex, vec2 uv ) {
  float shell = 1.0 - vMonsterFur.x;
  vec2 scale = mix( vec2( 1.0 ), MONSTER_FUR_RECT.zw - MONSTER_FUR_RECT.xy, shell );
  vec2 gx = dFdx( uv ) * scale;
  vec2 gy = dFdy( uv ) * scale;
  vec2 st = mix( uv, monsterFurAtlasUv( uv, vec2( textureSize( tex, 0 ) ), gx, gy ), shell );
  return textureGrad( tex, st, gx, gy );
}
`;
}

/** In place of `#include <map_fragment>`: three's chunk, through the remap; then the root shade and the wet tips. */
export function furMapFragment(): string {
  return `${replaceInChunk(THREE.ShaderChunk.map_fragment, "texture2D( map, vMapUv )", "monsterFurTexture( map, vMapUv )")}
diffuseColor.rgb *= mix( mix( ${glslFloat(FUR_ROOT_SHADE)}, 1.0, vMonsterFur.y ) * ( 1.0 - ${glslFloat(FUR_WET_DARKEN)} * vMonsterFur.z * vMonsterFur.y ), 1.0, vMonsterFur.x );`;
}

/** In place of `#include <normal_fragment_maps>`: three's chunk, the normal map through the same remap. */
export function furNormalFragment(): string {
  return replaceInChunk(THREE.ShaderChunk.normal_fragment_maps, "texture2D( normalMap, vNormalMapUv )", "monsterFurTexture( normalMap, vNormalMapUv )");
}

/**
 * In place of `#include <alphatest_fragment>`: the threshold rises outward
 * (s/n, faster where wet), so each shell keeps only the strands that reach
 * it; shell 0 keeps the material's cutoff (0.01, under the mask's 0.03
 * floor: a solid undercoat); a card tests its own _FUR.x along the lock.
 */
export const FUR_ALPHATEST_FRAGMENT = /* glsl */ `
#ifdef USE_ALPHATEST
float monsterCut = max( alphaTest, vMonsterFur.w );
#else
float monsterCut = vMonsterFur.w;
#endif
if ( diffuseColor.a < monsterCut ) discard;`;

// ------------------------------------------------------- TS mirrors ------

/** The widest gap between two shells, in pixels at the game's resting view, once the fur thins. */
export const FUR_SHELL_GAP_PX = 2;
/** The shell counts the fur thins through (with the rig's furShells on top, and 1, the undercoat alone). */
const SHELL_STEPS = [4, 8, 12] as const;

/** The fur's full depth on screen, in pixels, at `distance` (sphereLod.ts's resting view: 58° on 802 px). */
export function furShellPx(distance: number, furMaxLength: number): number {
  return (furMaxLength * FOCAL_PX) / Math.max(distance, 1e-3);
}

/**
 * How many shells (the base included) a monster's fur draws at `distance`.
 * The steps keep the gap between shells at or under FUR_SHELL_GAP_PX once
 * the fur thins (wider gaps read as stacked contour bands): every shell
 * while the fur is deeper than 12 × 2 px, then 12, 8 and 4, and the
 * undercoat alone once the whole fur is under 2 px deep. LOD1's fur base
 * thins the same way (the saucer's fur is still ~14 px deep at its
 * lod1Distance, so dropping every shell there would pop the silhouette).
 */
export function furShellCount(distance: number, furMaxLength: number, maxShells: number): number {
  const px = furShellPx(distance, furMaxLength);
  if (px <= FUR_SHELL_GAP_PX) return 1;
  for (let i = 0; i < SHELL_STEPS.length; i++) {
    const n = SHELL_STEPS[i];
    if (n < maxShells && px / n <= FUR_SHELL_GAP_PX) return n;
  }
  return maxShells;
}

/**
 * The TS mirror of monsterFurAtlasUv: an unbounded fur-base coordinate into
 * the shell rect ([u0, v0, u1, v1]) of a texW × texH atlas, inset by
 * `footprint` texels (the current mip's texels per pixel, at least 1).
 */
export function furAtlasUv(u: number, v: number, rect: readonly number[], texW: number, texH: number, footprint: number, out: { u: number; v: number }) {
  const fp = Math.max(footprint, 1);
  const iu = fp / texW, iv = fp / texH;
  out.u = rect[0] + iu + (u - Math.floor(u)) * (rect[2] - rect[0] - 2 * iu);
  out.v = rect[1] + iv + (v - Math.floor(v)) * (rect[3] - rect[1] - 2 * iv);
  return out;
}

/** Applies a fur material's fragment patches (shared by both monsters' fur). */
export function patchFurFragment(src: string, shellsRect: readonly number[], translucency: string): string {
  let fs = injectShader(src, "#include <common>", `${furFragmentHeader(shellsRect)}${translucency}`, "after");
  fs = injectShader(fs, "#include <map_fragment>", furMapFragment(), "replace");
  fs = injectShader(fs, "#include <alphatest_fragment>", FUR_ALPHATEST_FRAGMENT, "replace");
  fs = injectShader(fs, "#include <normal_fragment_maps>", furNormalFragment(), "replace");
  return injectShader(fs, "#include <lights_fragment_begin>", TRANSLUCENCY_FRAGMENT, "after");
}

/** Points a compiled shader's uTime / uMotion at the shared uniform objects. */
export function shareMonsterUniforms(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uTime = MONSTER_UNIFORMS.uTime;
  shader.uniforms.uMotion = MONSTER_UNIFORMS.uMotion;
}
