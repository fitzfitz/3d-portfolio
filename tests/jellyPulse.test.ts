import { describe, it, expect } from "vitest";
import { pulseRateTarget, SWIM_PULSE_GAIN, REDUCED_PULSE_RATE } from "../src/utils/jellyPulse";
import { JELLY_PULSE_RATE } from "../src/utils/jellyMood";

describe("pulseRateTarget", () => {
  it("is the mood rate untouched while it stands (swim 0)", () => {
    for (const m of ["calm", "curious", "startled"] as const) {
      expect(pulseRateTarget(JELLY_PULSE_RATE[m], 0, false)).toBe(JELLY_PULSE_RATE[m]);
    }
  });
  it("beats faster as it swims, monotonically", () => {
    let prev = pulseRateTarget(1, 0, false);
    for (let s = 0.1; s <= 1.0001; s += 0.1) {
      const r = pulseRateTarget(1, s, false);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
    expect(pulseRateTarget(1, 1, false)).toBeCloseTo(1 + SWIM_PULSE_GAIN, 10);
  });
  it("clamps the swim factor to 0..1", () => {
    expect(pulseRateTarget(1, 5, false)).toBe(pulseRateTarget(1, 1, false));
    expect(pulseRateTarget(1, -2, false)).toBe(1);
  });
  it("is one slow rate under reduced motion, whatever the mood or speed", () => {
    expect(REDUCED_PULSE_RATE).toBeLessThan(JELLY_PULSE_RATE.curious);
    expect(pulseRateTarget(1.7, 1, true)).toBe(REDUCED_PULSE_RATE);
    expect(pulseRateTarget(0.8, 0, true)).toBe(REDUCED_PULSE_RATE);
  });
});
