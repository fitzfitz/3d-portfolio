import { describe, it, expect } from "vitest";
import { GATE_POS, GATE_NORMAL, GATE_OPENING_R, GATE_SENSE_R, GATE_LINES } from "../src/data/dormantGate";
import { gateDistance, gatePassed, gateLine, seamIntensity, SEAM_IDLE, SEAM_SENSED, type GateRadio } from "../src/utils/gatePass";

/** A point `along` units in front of the gate plane (toward the sun) and `side` units off the axis. */
const at = (along: number, side = 0) => {
  const off = Math.abs(GATE_NORMAL[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const s = [
    GATE_NORMAL[1] * off[2] - GATE_NORMAL[2] * off[1],
    GATE_NORMAL[2] * off[0] - GATE_NORMAL[0] * off[2],
    GATE_NORMAL[0] * off[1] - GATE_NORMAL[1] * off[0],
  ];
  const l = Math.hypot(s[0], s[1], s[2]);
  return {
    x: GATE_POS[0] + GATE_NORMAL[0] * along + (s[0] / l) * side,
    y: GATE_POS[1] + GATE_NORMAL[1] * along + (s[1] / l) * side,
    z: GATE_POS[2] + GATE_NORMAL[2] * along + (s[2] / l) * side,
  };
};
const fresh = (): GateRadio => ({ approached: false, passed: false });

describe("gate pass-through", () => {
  it("counts a flight through the opening, in either direction", () => {
    expect(gatePassed(at(2), at(-2))).toBe(true);
    expect(gatePassed(at(-2), at(2))).toBe(true);
  });
  it("does not count a crossing outside the opening (through the frame or past it)", () => {
    expect(gatePassed(at(2, GATE_OPENING_R + 1), at(-2, GATE_OPENING_R + 1))).toBe(false);
  });
  it("does not count a jump, teleport or wrap across the plane", () => {
    expect(gatePassed(at(25), at(-25))).toBe(false);
  });
  it("counts a slow drift across the plane exactly once", () => {
    let passes = 0;
    for (let k = 0; k < 40; k++) if (gatePassed(at(2 - k * 0.1), at(2 - (k + 1) * 0.1))) passes++;
    expect(passes).toBe(1);
  });
});

describe("gate radio", () => {
  it("plays the approach line the first time inside the sense radius, then never again", () => {
    const s = fresh();
    expect(gateLine(s, at(GATE_SENSE_R + 5), at(GATE_SENSE_R + 4))).toBeNull();
    expect(gateLine(s, at(GATE_SENSE_R + 1), at(GATE_SENSE_R - 1))).toBe(GATE_LINES.approach);
    expect(gateLine(s, at(GATE_SENSE_R - 1), at(GATE_SENSE_R - 2))).toBeNull();
    expect(gateLine(s, at(GATE_SENSE_R + 30), at(GATE_SENSE_R + 31))).toBeNull();
    expect(gateLine(s, at(GATE_SENSE_R + 1), at(GATE_SENSE_R - 1))).toBeNull();
  });
  it("plays the pass line on the first pass only", () => {
    const s = fresh();
    gateLine(s, at(30), at(29));
    expect(gateLine(s, at(1), at(-1))).toBe(GATE_LINES.pass);
    expect(gateLine(s, at(-1), at(1))).toBeNull();
  });
  it("plays only the pass line when the first visit is a pass", () => {
    const s = fresh();
    expect(gateLine(s, at(1), at(-1))).toBe(GATE_LINES.pass);
    expect(gateLine(s, at(-2), at(-3))).toBeNull();
    expect(s).toEqual({ approached: true, passed: true });
  });
});

describe("seam glow", () => {
  it("holds a steady low glow under reduced motion, near or far", () => {
    for (const t of [0, 1.3, 7]) for (const d of [5, 200]) expect(seamIntensity(t, d, true)).toBe(SEAM_IDLE);
  });
  it("pulses faintly when nobody is near", () => {
    for (let t = 0; t < 12; t += 0.25) {
      const v = seamIntensity(t, 500, false);
      expect(v).toBeGreaterThanOrEqual(SEAM_IDLE * 0.5);
      expect(v).toBeLessThanOrEqual(SEAM_IDLE);
    }
    expect(seamIntensity(0, 500, false)).not.toBe(seamIntensity(1.5, 500, false));
  });
  it("brightens toward SEAM_SENSED as the ship closes in", () => {
    const far = seamIntensity(2, GATE_SENSE_R + 1, false);
    const near = seamIntensity(2, 5, false);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(SEAM_SENSED);
  });
  it("flickers smoothly and slowly, never a strobe", () => {
    let lo = Infinity, hi = -Infinity, prev = seamIntensity(0, 5, false);
    for (let i = 1; i <= 600; i++) {
      const v = seamIntensity(i / 60, 5, false);
      expect(Math.abs(v - prev)).toBeLessThanOrEqual(0.05);
      lo = Math.min(lo, v); hi = Math.max(hi, v); prev = v;
    }
    expect(hi - lo).toBeGreaterThan(0.2);
  });
  it("is deterministic", () => {
    expect(seamIntensity(3.21, 20, false)).toBe(seamIntensity(3.21, 20, false));
  });
});

describe("gateDistance", () => {
  it("measures from the gate centre", () => {
    expect(gateDistance(at(0))).toBeCloseTo(0, 9);
    expect(gateDistance(at(7))).toBeCloseTo(7, 9);
  });
});
