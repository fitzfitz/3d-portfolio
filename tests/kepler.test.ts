import { describe, it, expect } from "vitest";
import { keplerPosition, type CometOrbit } from "../src/utils/kepler";

const flat: CometOrbit = { a: 140, e: 0.62, periodSeconds: 380, phase: 0, inclination: 0, node: 0 };

const dist = (p: { x: number; y: number; z: number }) => Math.hypot(p.x, p.y, p.z);

describe("keplerPosition", () => {
  it("starts at perihelion: closest approach a(1-e)", () => {
    expect(dist(keplerPosition(0, flat))).toBeCloseTo(140 * (1 - 0.62), 1);
  });
  it("reaches aphelion a(1+e) at half period", () => {
    expect(dist(keplerPosition(190, flat))).toBeCloseTo(140 * (1 + 0.62), 0);
  });
  it("is periodic", () => {
    const p0 = keplerPosition(0, flat);
    const p1 = keplerPosition(380, flat);
    expect(p1.x).toBeCloseTo(p0.x, 1);
    expect(p1.z).toBeCloseTo(p0.z, 1);
  });
  it("moves much faster at perihelion than aphelion (Kepler's second law)", () => {
    const d = (t: number) => {
      const a = keplerPosition(t, flat);
      const b = keplerPosition(t + 1, flat);
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    };
    expect(d(0)).toBeGreaterThan(d(190) * 3);
  });
  it("rotations preserve heliocentric distance", () => {
    const steep = { ...flat, inclination: 1.1, node: 2.4 };
    for (const t of [0, 60, 190, 300]) {
      expect(dist(keplerPosition(t, steep))).toBeCloseTo(dist(keplerPosition(t, flat)), 6);
    }
  });
  it("90° inclination with node 0 puts the orbit in the XY plane", () => {
    const polar = { ...flat, inclination: Math.PI / 2 };
    for (const t of [30, 100, 250]) {
      expect(keplerPosition(t, polar).z).toBeCloseTo(0, 6);
    }
  });
  it("node rotates the flat orbit about Y", () => {
    const spun = { ...flat, node: Math.PI / 2 };
    const a = keplerPosition(60, flat);
    const b = keplerPosition(60, spun);
    expect(b.x).toBeCloseTo(a.z, 6);
    expect(b.z).toBeCloseTo(-a.x, 6);
  });
});
