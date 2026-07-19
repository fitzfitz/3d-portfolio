import { describe, it, expect } from "vitest";
import { pitchStep, noseDirection, trailFade, PITCH_MAX } from "../src/utils/pitchFlight";

const idle = { up: false, down: false };

describe("pitchStep", () => {
  it("pitch-up input raises pitch", () => {
    let s = { pitch: 0, pitchVel: 0 };
    for (let i = 0; i < 30; i++) s = pitchStep(s.pitch, s.pitchVel, { up: true, down: false }, 1 / 60);
    expect(s.pitch).toBeGreaterThan(0.1);
  });
  it("pitch-down input lowers pitch", () => {
    let s = { pitch: 0, pitchVel: 0 };
    for (let i = 0; i < 30; i++) s = pitchStep(s.pitch, s.pitchVel, { up: false, down: true }, 1 / 60);
    expect(s.pitch).toBeLessThan(-0.1);
  });
  it("clamps at ±PITCH_MAX and kills outward velocity", () => {
    let s = { pitch: 0, pitchVel: 0 };
    for (let i = 0; i < 600; i++) s = pitchStep(s.pitch, s.pitchVel, { up: true, down: false }, 1 / 60);
    expect(s.pitch).toBeLessThanOrEqual(PITCH_MAX + 1e-9);
    expect(s.pitchVel).toBeLessThanOrEqual(0 + 1e-9);
  });
  it("NO safe-return: idle pitch stays exactly where it was left", () => {
    let s = { pitch: 0.8, pitchVel: 0 };
    for (let i = 0; i < 600; i++) s = pitchStep(s.pitch, s.pitchVel, idle, 1 / 60);
    expect(s.pitch).toBeCloseTo(0.8, 5);
  });
  it("release decays pitch velocity toward zero", () => {
    let s = { pitch: 0, pitchVel: 1.8 };
    for (let i = 0; i < 120; i++) s = pitchStep(s.pitch, s.pitchVel, idle, 1 / 60);
    expect(Math.abs(s.pitchVel)).toBeLessThan(0.05);
  });
});

describe("noseDirection", () => {
  it("is always unit length", () => {
    for (const [yaw, pitch] of [[0, 0], [1.1, 0.7], [-2.4, -1.3], [Math.PI, 1.45]]) {
      const d = noseDirection(yaw, pitch);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
    }
  });
  it("level flight matches the old yaw heading convention (sin, 0, cos)", () => {
    const d = noseDirection(0.6, 0);
    expect(d.x).toBeCloseTo(Math.sin(0.6));
    expect(d.y).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(Math.cos(0.6));
  });
  it("positive pitch points the nose up", () => {
    expect(noseDirection(0, 0.5).y).toBeCloseTo(Math.sin(0.5));
  });
});

describe("trailFade", () => {
  it("full trail in level and shallow flight", () => {
    expect(trailFade(0)).toBe(1);
    expect(trailFade(0.25)).toBe(1);
    expect(trailFade(-0.25)).toBe(1);
  });
  it("fully faded before the camera aligns with the trail axis", () => {
    expect(trailFade(0.7)).toBe(0);
    expect(trailFade(-0.7)).toBe(0);
    expect(trailFade(1.45)).toBe(0);
  });
  it("fades smoothly and symmetrically in between", () => {
    expect(trailFade(0.475)).toBeCloseTo(0.5, 5);
    expect(trailFade(-0.475)).toBeCloseTo(0.5, 5);
    expect(trailFade(0.3)).toBeGreaterThan(trailFade(0.5));
  });
});
