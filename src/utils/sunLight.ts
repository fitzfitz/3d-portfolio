import { AU } from "../constants";

/**
 * Inverse-square sunlight and the camera's exposure (F3; law L19).
 *
 * The sun is a point light with decay 2, so a surface at distance d gets
 * SUN_LIGHT_INTENSITY / d², which is today's 2.1 at Ruangrapi's orbit (1 AU).
 * The camera adapts like an eye or an auto-exposing lens (lawful, L22):
 * exposure = clamp((d / AU)^1.5, EXPOSURE_MIN, EXPOSURE_MAX), d being the
 * camera's distance from the sun. It is exactly 1 at 1 AU; the net brightness
 * of a lit surface, irradiance × exposure, falls as (AU / d)^0.5 between the
 * clamps, so the outer system reads dimmer but readable.
 */

/** Irradiance at 1 AU: the old decay-0 intensity, so Ruangrapi looks as it did. */
export const SUN_IRRADIANCE_AT_AU = 2.1;
/** The point light's intensity under decay 2 (three: I / d²). */
export const SUN_LIGHT_INTENSITY = SUN_IRRADIANCE_AT_AU * AU * AU;
/** A world-event flare lifts the light by this fraction (2.1 → 3.2 before F3). */
export const SUN_FLARE_SWELL = 1.1 / 2.1;

export const EXPOSURE_POWER = 1.5;
export const EXPOSURE_MIN = 0.15;
export const EXPOSURE_MAX = 2.5;
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
 * Sets the compensation. Its users are never exposed by the renderer: the
 * custom ShaderMaterials include no `<tonemapping_fragment>`, and the course
 * gates are `toneMapped: false`. Only the composer's ToneMapping pass exposes
 * them, and it exposes every pixel. So they need 1 / exposure exactly when that
 * pass runs (PostFX enabled, i.e. not low-perf), and 1 otherwise.
 */
export function setExposureCompensation(exposure: number, postPassExposes: boolean): void {
  exposureCompensation.value = postPassExposes ? 1 / exposure : 1;
}

/**
 * A camera cut (first frame, jump, teleport): the camera is somewhere new, so
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

/**
 * Fuxx's surface albedo lift (I1). Its baked texture is far darker than any
 * solar-system body: median linear luminance 0.014, p90 0.024 (Ruangrapi 0.053,
 * Portfolio 0.095), so its lit side read near-black. A C-type asteroid reflects
 * about 4%, which is the lawful target (L29 one light source, L36 no unlit
 * matter): the material colour multiplies the map so the p90 reaches ~0.07 and
 * the median ~0.04. Emissive rifts are untouched. Baking it into
 * gen_planets.mjs is a follow-up (docs/FOLLOW-UPS.md).
 */
export const FUXX_TEXEL_P90_LINEAR = 0.0243;
export const FUXX_ALBEDO_LIFT = 3;
