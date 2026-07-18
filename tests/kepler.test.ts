import { describe, it, expect } from "vitest";
import { keplerPosition } from "../src/utils/kepler";

const orbit = { a: 140, e: 0.62, periodSeconds: 380, phase: 0, tilt: 0.18 };

describe("keplerPosition", () => {
  it("starts at perihelion: closest approach a(1-e) on the +x axis", () => {
    const p = keplerPosition(0, orbit);
    expect(p.x).toBeCloseTo(140 * (1 - 0.62), 1);
    expect(p.z).toBeCloseTo(0, 1);
  });
  it("reaches aphelion a(1+e) at half period", () => {
    const p = keplerPosition(190, orbit);
    expect(p.x).toBeCloseTo(-140 * (1 + 0.62), 0);
  });
  it("is periodic", () => {
    const p0 = keplerPosition(0, orbit);
    const p1 = keplerPosition(380, orbit);
    expect(p1.x).toBeCloseTo(p0.x, 1);
    expect(p1.z).toBeCloseTo(p0.z, 1);
  });
  it("moves much faster at perihelion than aphelion (Kepler's second law)", () => {
    const d = (t: number) => {
      const a = keplerPosition(t, orbit);
      const b = keplerPosition(t + 1, orbit);
      return Math.hypot(b.x - a.x, b.z - a.z);
    };
    expect(d(0)).toBeGreaterThan(d(190) * 3);
  });
  it("tilts the orbital plane: y proportional to z", () => {
    const p = keplerPosition(95, orbit);
    expect(p.y).toBeCloseTo(p.z * 0.18, 5);
  });
});
