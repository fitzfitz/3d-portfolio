import { AU, SYSTEM_RADIUS } from "../constants";

/**
 * Inverse-square sunlight and the camera's exposure (F3; law L19).
 *
 * The sun is a point light with decay 2, so a surface at distance d gets
 * SUN_LIGHT_INTENSITY / d², which is today's 2.1 at Ruangrapi's orbit (1 AU).
 * The camera adapts fully, like a spacecraft camera exposing for its target
 * (lawful, L22): exposure = clamp((d / AU)^2, EXPOSURE_MIN, EXPOSURE_MAX), d
 * being the camera's distance from the sun. It is exactly 1 at 1 AU and
 * cancels the inverse-square sunlight wherever it is unclamped, so the net
 * brightness of a lit surface, irradiance × exposure, is its 1 AU value at
 * every distance from AU·√EXPOSURE_MIN (≈ 44.5) to the edge: a world reads
 * at its true albedo wherever the camera meets it. Distance reads from the
 * sun's shrinking disc instead. The ceiling is the edge's own exposure, so
 * the law holds all the way out. (Until 2026-10-19 main had partial
 * adaptation, clamp((d / AU)^1.5, 0.15, 2.5).)
 */

/** Irradiance at 1 AU: the old decay-0 intensity, so Ruangrapi looks as it did. */
export const SUN_IRRADIANCE_AT_AU = 2.1;
/** The point light's intensity under decay 2 (three: I / d²). */
export const SUN_LIGHT_INTENSITY = SUN_IRRADIANCE_AT_AU * AU * AU;
/** A world-event flare lifts the light by this fraction (2.1 → 3.2 before F3). */
export const SUN_FLARE_SWELL = 1.1 / 2.1;

export const EXPOSURE_POWER = 2;
export const EXPOSURE_MIN = 0.15;
/** The exposure at the system's edge, ≈ 17.4: no clamp inside the system. */
export const EXPOSURE_MAX = (SYSTEM_RADIUS / AU) ** EXPOSURE_POWER;
export const EXPOSURE_HALF_LIFE_S = 1.5;

/** Sunlight falling on a surface `d` scene units from the sun. */
export function sunIrradiance(d: number): number {
  return SUN_LIGHT_INTENSITY / (d * d);
}

/** The exposure the camera settles to at distance `d` from the sun. */
export function targetExposure(d: number): number {
  const e = Math.pow(d / AU, EXPOSURE_POWER);
  return Math.min(EXPOSURE_MAX, Math.max(EXPOSURE_MIN, e));
}

/**
 * One frame of adaptation: closes half the gap every EXPOSURE_HALF_LIFE_S
 * seconds, frame-rate independent. `snap` (reduced motion) jumps straight to
 * the target, since a slow brightness swell is exactly that kind of motion.
 */
export function stepExposure(current: number, target: number, dt: number, snap: boolean): number {
  if (snap) return target;
  const k = 1 - Math.pow(0.5, Math.max(0, dt) / EXPOSURE_HALF_LIFE_S);
  return current + (target - current) * k;
}

/**
 * Sunlight at `d` as a fraction of what Ruangrapi gets at 1 AU: (AU / d)².
 * Scales lit effects drawn by custom shaders that the point light never
 * reaches, such as the atmosphere rims (Rayleigh scattering, L27).
 */
export function irradianceVsAU(d: number): number {
  return sunIrradiance(d) / SUN_IRRADIANCE_AT_AU;
}

/**
 * The scene's fill (the ambient light and the IBL environment) is scattered
 * sunlight too, so it falls off like the sun: (AU / d)² at the camera's
 * distance d, clamped to at most 1 so the inner system keeps today's fill.
 * From 1 AU out the exposure cancels it, so a night side keeps the same ratio
 * to its day side at every distance.
 */
export function fillScale(cameraDistance: number): number {
  return Math.min(1, irradianceVsAU(cameraDistance));
}

/**
 * The unlit backdrop's exposure curve from 1 AU out: power 1.5, unclamped
 * (main clamped it at 2.5, so beyond r ≈ 212 the backdrop now reads up to
 * ~3.4× main's at the edge; inside 1 AU it follows the full power-2 exposure).
 * The painted sky, the nebula clouds and the distant galaxies are not sunlit,
 * so a longer exposure brightens them, as it would in a real camera; under
 * full adaptation the Milky Way band glared near the edge (≈ 0.7% of the
 * frame near-white at r 425, against 0.06% on the power-1.5 curve).
 */
export const BACKDROP_EXPOSURE_POWER = 1.5;

/**
 * The one disclosed factor that tones the backdrop down (L19): the exposure's
 * growth beyond the power-1.5 curve, undone, (AU / d)^(EXPOSURE_POWER −
 * BACKDROP_EXPOSURE_POWER) with d held to [AU, SYSTEM_RADIUS], so it only ever
 * dims (1 at 1 AU and inward, ≈ 0.49 at the edge). The backdrop then follows
 * (d / AU)^1.5 from 1 AU to the edge and the exposure's (d / AU)^2 inside
 * 1 AU. The stars are not toned: they may brighten.
 */
export function backdropScale(cameraDistance: number): number {
  const d = Math.min(SYSTEM_RADIUS, Math.max(AU, cameraDistance));
  return (AU / d) ** (EXPOSURE_POWER - BACKDROP_EXPOSURE_POWER);
}

/**
 * Shared factor for the backdrop sprites (the nebula clouds and the distant
 * galaxies), which multiply their colour by it each frame. Read directly,
 * like exposureCompensation.
 */
export const backdropDim = { value: 1 };

/**
 * Tones the backdrop for a camera `cameraDistance` from the sun: the painted
 * sky through `scene.backgroundIntensity` (a uniform: no new program) and the
 * sprites through backdropDim. Allocation-free; called every frame and on a
 * camera cut, like applyFill.
 */
export function applyBackdrop(scene: { backgroundIntensity: number }, cameraDistance: number): void {
  const k = backdropScale(cameraDistance);
  backdropDim.value = k;
  scene.backgroundIntensity = k;
}

/** The ambient light's intensity at full fill (1 AU and inward). */
export const AMBIENT_BASE = 0.15;

/**
 * GlobalCanvas's ambient light (registered by its ref), so both ExposureDriver
 * and a camera cut (Spaceship) can reach it without a scene search.
 */
export const fillLight: { ambient: { intensity: number } | null } = { ambient: null };

/**
 * Sets the fill for a camera `cameraDistance` from the sun: the ambient light
 * to AMBIENT_BASE × fillScale and `scene.environmentIntensity` to fillScale.
 * Allocation-free; called every frame and on a camera cut.
 */
export function applyFill(scene: { environmentIntensity: number }, cameraDistance: number): void {
  const k = fillScale(cameraDistance);
  if (fillLight.ambient) fillLight.ambient.intensity = AMBIENT_BASE * k;
  scene.environmentIntensity = k;
}

/**
 * Shared uniform for the sun's self-luminous parts and the instrument
 * overlays: the sun's core and corona, and the orbit rings, zone circles and
 * guide lines (guideLine.ts). They multiply their output by it, so they look
 * the same at every exposure. Lit matter, such as Ruangrapi's planetary ring,
 * is NOT compensated: it follows exposure like its planet. The sun's glare
 * sprites and the ring-course gates are compensated too, but through their
 * colour each frame (Sun.tsx, RingCourse.tsx), since they are built-in
 * materials. Materials reference this object directly, so one write a frame
 * reaches all of them with no allocation and no recompile.
 */
export const exposureCompensation = { value: 1 };

/**
 * Shared uniform for lit matter drawn by custom shaders: the planetary rings
 * (guideLine.ts) and the atmosphere rims (atmosphereMaterial.ts). Like the
 * lit planets, they must follow the exposure, but the renderer never exposes
 * them (no `<tonemapping_fragment>`). So they multiply by this: 1 where the
 * composer's ToneMapping pass exposes every pixel, the exposure itself where
 * it does not (low-perf). Referenced directly, like exposureCompensation.
 */
export const litExposure = { value: 1 };

/**
 * Sets the compensation. Its users are never exposed by the renderer: the
 * custom ShaderMaterials include no `<tonemapping_fragment>`, and the course
 * gates are `toneMapped: false`. Only the composer's ToneMapping pass exposes
 * them, and it exposes every pixel. So they need 1 / exposure exactly when that
 * pass runs (PostFX enabled, i.e. not low-perf), and 1 otherwise. Lit matter
 * in custom shaders needs the opposite: litExposure, 1 when that pass runs and
 * the exposure otherwise.
 */
export function setExposureCompensation(exposure: number, postPassExposes: boolean): void {
  exposureCompensation.value = postPassExposes ? 1 / exposure : 1;
  litExposure.value = postPassExposes ? 1 : exposure;
}

/**
 * A camera cut (first frame, jump): the camera is somewhere new, so
 * the exposure is re-metered there at once instead of easing from the old
 * place's value (which would blow out or black out the first seconds).
 * Spaceship calls it on the very frame it snaps the camera, after
 * ExposureDriver has already run, so the frame renders correctly exposed.
 * Allocation-free; `gl` is anything with a toneMappingExposure.
 */
export function cutExposure(gl: { toneMappingExposure: number }, cameraDistance: number, postPassExposes: boolean): void {
  const e = targetExposure(cameraDistance);
  gl.toneMappingExposure = e;
  setExposureCompensation(e, postPassExposes);
}
