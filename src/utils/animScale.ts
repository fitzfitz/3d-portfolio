/**
 * A live tuning multiplier for decorative animation amplitudes and rates.
 *
 * Why this exists: animation calibration was missed twice, because it cannot be
 * verified the way the rest of this codebase is. A probe can prove a value
 * changed — "star shell rotated 0.0125 rad over 2.5s" — while that change is
 * completely imperceptible to a person looking at the screen. Numbers passing is
 * not the same as motion reading.
 *
 * So instead of guessing amplitudes and rebuilding, every perceptibility-limited
 * animation multiplies by `animScale()`. In dev the value is settable live from
 * the browser console via `__fitz.setAnimScale(n)`, so the calibration can be
 * swept by eye in seconds rather than over several round trips.
 *
 * **This is a temporary tuning aid, not permanent architecture.** Once the right
 * factors are known they get baked into the constants at each site and this
 * module is deleted. It defaults to 1 so production is always exactly whatever
 * the committed constants say — the knob never silently changes what ships.
 */
let scale = 1;

/** Multiplier applied to decorative amplitudes/rates. 1 = committed values. */
export function animScale(): number {
  return scale;
}

/**
 * Set the multiplier. Exposed on `window.__fitz.setAnimScale` in dev only.
 * Guards against nonsense so a typo in the console cannot freeze or invert
 * every animation in the scene and leave you wondering what broke.
 */
export function setAnimScale(v: number): number {
  if (!Number.isFinite(v) || v <= 0) {
    // eslint-disable-next-line no-console
    console.warn(`[animScale] ignoring ${v} — must be a finite number > 0`);
    return scale;
  }
  scale = Math.min(v, 50);
  return scale;
}
