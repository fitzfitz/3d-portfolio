import { SUN_RADIUS } from "../constants";

/**
 * Sizing the sun's lens effects and corona to the disc the camera actually
 * sees (L22, L35). Pure and allocation-free: Sun.tsx calls these every frame.
 */

/** Closest the camera is treated as being, as a share of the radius: keeps the maths finite at the surface. */
const MAX_SIN = 0.995;

/**
 * The disc's apparent radius in half-screen-heights: tan(asin(R / d)) over
 * tan(fov / 2), with `d` the camera's distance from the sun's centre. The
 * true limb, not R / d (9% short at 50 units from a 24-unit core).
 */
export function sunApparentRadius(d: number, fovDeg: number, radius = SUN_RADIUS): number {
  const s = d > 0 ? Math.min(MAX_SIN, radius / d) : MAX_SIN;
  return s / Math.sqrt(1 - s * s) / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * The apparent radius the spike and veil sprites were sized for: the old
 * 8-unit sun from ~115 out. A bigger disc would swallow them, so they grow
 * with it past this.
 */
export const LENS_REF_APPARENT_R = 0.12;

/** Spike and veil sprite scale for a disc of apparent radius `apparentR`. */
export function lensScale(apparentR: number): number {
  return Math.max(1, apparentR / LENS_REF_APPARENT_R);
}

/**
 * Where the corona billboard goes so its disc edge (uDisc) lands on the
 * sphere's limb. From `d` out the limb is a circle R² / d toward the camera
 * from the centre, of radius R·√(1 − R²/d²): `offset` is that shift along the
 * sun→camera line and `scale` the billboard's scale (its disc is SUN_RADIUS at
 * scale 1). The halo then starts at the limb at every distance instead of
 * hiding behind the disc, and its outer edge never reaches further from the
 * centre than at scale 1 (CORONA_SIZE / 2), so it stays clear of the belt.
 */
export function coronaLimbFit(d: number, out: { offset: number; scale: number }, radius = SUN_RADIUS): { offset: number; scale: number } {
  const s = d > 0 ? Math.min(MAX_SIN, radius / d) : MAX_SIN;
  out.offset = radius * s;
  out.scale = Math.sqrt(1 - s * s);
  return out;
}
