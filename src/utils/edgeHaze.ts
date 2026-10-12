import { COSMIC_BOUNDS } from "../constants";

/**
 * The soft edge (docs/superpowers/specs/2026-10-12-flight-feel-design.md §4):
 * the ±COSMIC_BOUNDS wrap stays, but it happens unseen inside a nebula haze
 * that thickens from HAZE_START to the bounds on whichever axis is nearest.
 */
export const HAZE_START = 215;
/** Overlay opacity at full depth: enough that the wrap is never visible. */
export const HAZE_MAX_OPACITY = 0.92;
const LINE_AT = 0.3;
const REARM_BELOW = 0.1;

/** 0 inside HAZE_START, smoothstep to 1 at the bounds, on the nearest-to-edge axis. */
export function edgeDepth(x: number, y: number, z: number): number {
  const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  const u = Math.min(1, Math.max(0, (m - HAZE_START) / (COSMIC_BOUNDS - HAZE_START)));
  return u * u * (3 - 2 * u);
}

/**
 * Wraps one coordinate by exactly one period (2 × bounds), so the ship lands
 * where `toroidal.ts` already thinks it is. The old wrap snapped to ∓247: a
 * 497u jump against helpers that assume 500.
 */
export function wrapCoord(v: number, bounds = COSMIC_BOUNDS): number {
  if (v > bounds) return v - bounds * 2;
  if (v < -bounds) return v + bounds * 2;
  return v;
}

/**
 * One haze radio line per visit: fires the first time depth passes LINE_AT
 * while the radio is free and no race runs (held, not dropped, while it
 * isn't), and re-arms once the pilot is back below REARM_BELOW.
 */
export class HazeLineGate {
  private armed = true;
  update(depth: number, radioBusy: boolean, raceRunning: boolean): boolean {
    if (depth < REARM_BELOW) { this.armed = true; return false; }
    if (!this.armed || depth < LINE_AT || radioBusy || raceRunning) return false;
    this.armed = false;
    return true;
  }
}
