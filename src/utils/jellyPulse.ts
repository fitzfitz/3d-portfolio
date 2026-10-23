/**
 * Pulse rate for the jellyfish bell (spec 2026-10-23-jellyfish-guide, "Swim
 * posture" > Bell pulse, and "Reduced motion"). Pure: the frame loop damps the
 * result and integrates the pulse phase on the CPU (`pulseClock`), so a rate
 * change speeds the beat up without ever jumping its phase, which a rate
 * multiplying `uTime` inside the shader would.
 */

/** Extra beat rate at full swim: x1.55 at swim 1, so propulsion reads faster. */
export const SWIM_PULSE_GAIN = 0.55;
/** Reduced motion: one slow pulse only, whatever the mood or speed. */
export const REDUCED_PULSE_RATE = 0.35;

/** Target pulse rate from the mood's base rate and the 0..1 swim factor. */
export function pulseRateTarget(moodRate: number, swim: number, reducedMotion: boolean): number {
  if (reducedMotion) return REDUCED_PULSE_RATE;
  return moodRate * (1 + SWIM_PULSE_GAIN * Math.min(1, Math.max(0, swim)));
}
