import { LOCK_ENGAGE_FACTOR } from "../constants";

/**
 * Orbit capture (spec §5.4). Locking opens the dossier modal, so a fast
 * slingshot must be able to skim past without it: capture needs a slow
 * approach, as real capture needs low relative speed. The surface net always
 * captures, so warping straight at a planet still docks and nothing can pass
 * through one. 2u covers a 1.95u warp step at the 0.05s frame clamp.
 */
export const CAPTURE_SPEED = 14;
export const CAPTURE_SURFACE_MARGIN = 2;

export function canCapture(dist: number, size: number, speed: number): boolean {
  return dist < size * LOCK_ENGAGE_FACTOR && (speed < CAPTURE_SPEED || dist < size + CAPTURE_SURFACE_MARGIN);
}

/**
 * Pushes `p` out to `minR` from `center` if it is inside, along the same
 * direction (straight up if it sits exactly on the centre). Docking starts the
 * orbit ring from the ship's horizontal offset and eases its height, which
 * dips the ship inward while it settles; with capture as deep as the surface
 * net that dip reached 0.3u from the surface. Spaceship holds a docked ship at
 * size + CAPTURE_SURFACE_MARGIN with this.
 */
export function keepOutside(p: { x: number; y: number; z: number }, center: { x: number; y: number; z: number }, minR: number): void {
  const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= minR) return;
  if (d < 1e-6) { p.x = center.x; p.y = center.y + minR; p.z = center.z; return; }
  const k = minR / d;
  p.x = center.x + dx * k; p.y = center.y + dy * k; p.z = center.z + dz * k;
}
