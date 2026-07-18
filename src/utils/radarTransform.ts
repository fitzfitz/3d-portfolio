/**
 * World-delta -> radar coords for a heading-up display.
 * Returns x (screen right positive) and up (screen up positive).
 * Forward in world x/z is (sin heading, cos heading); screen right is (-cos heading, sin heading).
 */
export function worldToRadar(dx: number, dz: number, heading: number): { x: number; up: number } {
  const cosA = Math.cos(heading);
  const sinA = Math.sin(heading);
  return {
    x: dz * sinA - dx * cosA,
    up: dx * sinA + dz * cosA,
  };
}
