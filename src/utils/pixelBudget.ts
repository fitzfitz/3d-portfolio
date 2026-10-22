/**
 * How many pixels the canvas draws: the device pixel ratio, capped at
 * MAX_DPR as before, and further so the canvas holds at most PIXEL_BUDGET
 * pixels. Every screen-sized buffer (the composer's targets, Bloom's chain,
 * SMAA's, the canvas itself) scales with this count: measured on the real
 * GPU, about 240 MB of the GPU process per million pixels (2026-10-22,
 * docs/PERF-BUDGETS.md "GPU memory").
 *
 * It never drops below one pixel per CSS pixel: a large monitor keeps its
 * full resolution rather than an upscaled blur. The HUD is HTML and always
 * draws at the screen's own resolution.
 */
export const MAX_DPR = 1.5;
/** Canvas pixels at most, where the screen has more (a Retina laptop). */
export const PIXEL_BUDGET = 2_000_000;

export function budgetDpr(cssWidth: number, cssHeight: number, deviceDpr: number): number {
  const screen = Math.min(deviceDpr, MAX_DPR);
  const area = cssWidth * cssHeight;
  if (area <= 0) return screen;
  const budget = Math.sqrt(PIXEL_BUDGET / area);
  return Math.max(Math.min(1, deviceDpr), Math.min(screen, budget));
}
