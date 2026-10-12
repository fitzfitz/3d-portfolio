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
