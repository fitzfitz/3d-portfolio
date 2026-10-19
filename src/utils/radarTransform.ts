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
 * (discovery, not signposts). Uncharted, "free": a blip at its true scaled
 * spot inside RADAR_RANGE, never rim-clamped or dimmed (it is only shown
 * within range, so it is always inside the rim), and nothing beyond, so it
 * is found by flying. Charted, "planet": drawn exactly like a planet, pinned
 * to the rim by its horizontal distance, with the altitude chevron.
 */
export function radarShowsWorld(charted: boolean, dist: number): "planet" | "free" | "hidden" {
  if (charted) return "planet";
  return dist <= RADAR_RANGE ? "free" : "hidden";
}

/**
 * Where a blip lands, from its radar coords (`sx`, `up`, world units):
 * scaled, and when `clamp` is set (planets, charted worlds, destinations)
 * pinned to just inside the rim once its horizontal distance passes it.
 * `onRim` blips are drawn dimmed. Written into `out` (a frame loop passes
 * its own scratch, so it allocates nothing).
 */
export function radarBlip(
  sx: number, up: number, scale: number, rimR: number, clamp: boolean,
  out: { px: number; py: number; onRim: boolean } = { px: 0, py: 0, onRim: false },
): { px: number; py: number; onRim: boolean } {
  out.px = sx * scale;
  out.py = -up * scale;
  out.onRim = false;
  const dist = Math.hypot(out.px, out.py);
  if (clamp && dist > rimR - 3) {
    const k = (rimR - 3) / Math.max(dist, 1e-6);
    out.px *= k; out.py *= k; out.onRim = true;
  }
  return out;
}
