import { irradianceVsAU } from "./sunLight";

/**
 * Far bodies as dots (real-solar-system spec §6.2): a body whose disc is under
 * 2 px across is still drawn, as a DOT_PX point of its colour (BodyDots.tsx),
 * so from Earth the outer planets read as wandering points along the ecliptic,
 * as they do in a real sky.
 */

/** The dot's size, CSS px across: the 2 px disc it stands in for. */
export const DOT_PX = 2;

/**
 * Radius in pixels of a sphere of `radius` seen centred from `distance` (both
 * u), through a vertical field of view `fovYRad` on a `viewportH` px tall view:
 * f·r / √(d² − r²), f = (H / 2) / tan(fov / 2), the silhouette's tangent
 * (sphereLod.ts measures its levels the same way). Infinite from inside.
 */
export function projectedRadiusPx(radius: number, distance: number, fovYRad: number, viewportH: number): number {
  if (distance <= radius) return Infinity;
  const f = viewportH / 2 / Math.tan(fovYRad / 2);
  return (f * radius) / Math.sqrt(distance * distance - radius * radius);
}

/** True when the body projects under 1 px in radius (a disc under 2 px across). */
export function needsDot(radius: number, distance: number, fovYRad: number, viewportH: number): boolean {
  return projectedRadiusPx(radius, distance, fovYRad, viewportH) < 1;
}

/**
 * The phase law of a Lambert sphere: the disc's light at phase angle α (Sun–
 * body–viewer, rad) as a fraction of full phase, (sin α + (π − α) cos α) / π.
 * 1 full, 1/π at quarter, 0 new.
 */
export function lambertPhase(alpha: number): number {
  return (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
}

interface V3 { x: number; y: number; z: number }

/**
 * How bright a dot is, relative to its colour (ruling R25: the spec's "sunlit
 * colour"): the sunlight at the body's live distance from the Sun (at the
 * origin) as a fraction of 1 AU's (sunLight.ts irradianceVsAU, (AU / r)²),
 * times the Lambert phase seen from `cam`. Lit matter: the camera exposure
 * acts on it as on the body.
 */
export function dotBrightness(p: V3, cam: V3): number {
  const r = Math.hypot(p.x, p.y, p.z);
  const vx = cam.x - p.x, vy = cam.y - p.y, vz = cam.z - p.z;
  const v = Math.hypot(vx, vy, vz);
  if (r === 0 || v === 0) return 0;
  // Sun direction from the body is −p.
  const cosA = Math.max(-1, Math.min(1, -(p.x * vx + p.y * vy + p.z * vz) / (r * v)));
  return irradianceVsAU(r) * lambertPhase(Math.acos(cosA));
}

/** `color` (linear) × dotBrightness, written into `out`. */
export function dotColor(color: { r: number; g: number; b: number }, p: V3, cam: V3, out: { r: number; g: number; b: number }): void {
  const k = dotBrightness(p, cam);
  out.r = color.r * k; out.g = color.g * k; out.b = color.b * k;
}

/** How far toward the camera, in body radii, a dot stands off its body's centre. */
export const DOT_LIFT = 1.05;

/**
 * Where a body's dot is drawn: just in front of its near limb, DOT_LIFT
 * radii from the centre toward the camera, so the body's own sub-pixel
 * sphere never wins the depth test against it. Written into `out`.
 */
export function dotPosition(p: V3, radius: number, cam: V3, out: V3): void {
  const vx = cam.x - p.x, vy = cam.y - p.y, vz = cam.z - p.z;
  const k = (DOT_LIFT * radius) / (Math.hypot(vx, vy, vz) || 1);
  out.x = p.x + vx * k; out.y = p.y + vy * k; out.z = p.z + vz * k;
}
