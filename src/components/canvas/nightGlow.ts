import * as THREE from "three";
import { sunShadowUniforms } from "./sunShadow";

/**
 * Emissive light that shows only where the sun does not: Earth's city lights
 * and Io's volcanic hot spots (L33). three adds an emissive map on the lit
 * hemisphere too, which would put Earth's lights in broad daylight; this mask
 * is applied right after the emissive map: full past a short twilight on the
 * night side, zero on the whole lit hemisphere, and lifted to `uNightEclipse`
 * (0..1, the material's own uniform) while the body sits in another's shadow:
 * Io in Jupiter's umbra glows on its day side too.
 *
 * The sun is the point light at the world origin. Its view-space position is
 * sunShadow.ts's uSunView, which the shadow patch refreshes from the camera
 * before every draw, so a night-glow material must also be patched by
 * patchSunShadow (after this). One compile hook for every such material, so
 * Earth and Io share one program; each keeps its own eclipse uniform.
 */

/** The fragment chunk that replaces `#include <emissivemap_fragment>`. nightGlowFactor mirrors it. */
export const NIGHT_GLOW_FRAGMENT = /* glsl */ `#include <emissivemap_fragment>
	vec3 toSun = normalize( uSunView + vViewPosition );
	totalEmissiveRadiance *= max( smoothstep(0.0, -0.2, dot(normal, toSun)), uNightEclipse );`;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The CPU mirror of the mask: `nDotSun` is the cosine between the surface
 * normal and the direction to the sun, `eclipse` the fraction of the sun the
 * body has lost to another's shadow.
 */
export function nightGlowFactor(nDotSun: number, eclipse: number): number {
  return Math.max(smoothstep(0, -0.2, nDotSun), eclipse);
}

/**
 * The eclipse factor for a body whose sunlight is `sunVisible` (0..1) of a
 * clear sun: 0 while at least half the sun shows (a glow on a day side lit
 * at half strength or more would be swamped), rising to 1 in the umbra. The
 * drawn sun is ~45× the real one (P3), so its penumbra is wide: Io spends
 * hours of the close-up clock at 0.7, which must not light its day side.
 */
export function eclipseGlow(sunVisible: number): number {
  return smoothstep(0.5, 0, sunVisible);
}

type EclipseUniform = { value: number };

function nightGlowCompile(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uSunView = sunShadowUniforms.uSunView;
  shader.uniforms.uNightEclipse = this.userData.nightEclipse as EclipseUniform;
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform vec3 uSunView;\nuniform float uNightEclipse;")
    .replace("#include <emissivemap_fragment>", NIGHT_GLOW_FRAGMENT);
}

/**
 * Masks `material`'s emissive light to the night side (and to eclipses).
 * Call before patchSunShadow, which composes over this hook. Returns the
 * eclipse uniform (0 by default: Earth's stays 0); the caller writes it each
 * frame where the body can be eclipsed whole (Io).
 */
export function patchNightGlow(material: THREE.Material, eclipse: EclipseUniform = { value: 0 }): EclipseUniform {
  material.userData.nightEclipse = eclipse;
  material.onBeforeCompile = nightGlowCompile;
  return eclipse;
}
