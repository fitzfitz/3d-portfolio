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
 * Shared uniform for self-luminous bodies and instrument overlays (the sun's
 * core, corona and glare; orbit rings, zone circles, guide lines, planet
 * rings). They multiply their output by it so they look the same at every
 * exposure. Materials reference this object directly, so one write a frame
 * reaches all of them with no allocation and no recompile.
 */
export const exposureCompensation = { value: 1 };

/**
 * Sets the compensation for the custom ShaderMaterials above. None of them
 * includes `<tonemapping_fragment>`, so the renderer never applies exposure to
 * them; only the composer's ToneMapping pass does, and that pass exposes every
 * pixel. So they need 1 / exposure exactly when that pass runs (PostFX
 * enabled, i.e. not low-perf), and 1 otherwise.
 */
export function setExposureCompensation(exposure: number, postPassExposes: boolean): void {
  exposureCompensation.value = postPassExposes ? 1 / exposure : 1;
}
