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
