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

/**
 * Relative-altitude chevron for a radar blip. Dead band ±6 (targets at the
 * ship's level get no chevron); alpha ramps linearly and saturates at 80.
 */
export function altitudeCue(dy: number): { dir: -1 | 0 | 1; alpha: number } {
  const mag = Math.abs(dy);
  if (mag < 6) return { dir: 0, alpha: 0 };
  return { dir: dy > 0 ? 1 : -1, alpha: Math.min(1, (mag - 6) / 74) };
}

/** World units mapped to the radar's radius. */
export const RADAR_RANGE = 220;

/**
 * How the radar shows a world, `dist` its 3D distance from the ship
 * (discovery, not signposts): uncharted, a blip inside RADAR_RANGE and
 * nothing beyond (no rim arrow), so it is found by flying; charted, like a
 * planet, a blip in range and pinned to the rim beyond.
 */
export function radarShowsWorld(charted: boolean, dist: number): "blip" | "rim" | "hidden" {
  if (dist <= RADAR_RANGE) return "blip";
  return charted ? "rim" : "hidden";
}
