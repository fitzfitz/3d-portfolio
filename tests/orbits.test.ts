import { describe, it, expect } from "vitest";
import { orbitPosition, type OrbitalElements } from "../src/utils/orbits";

const base: OrbitalElements = { radius: 100, angularSpeed: 0.01, inclination: 0, node: 0, phase: 0 };

describe("orbitPosition", () => {
  it("stays exactly on the sphere of its radius (rotations preserve length)", () => {
    const el = { ...base, inclination: 1.0472, node: 4.1888, phase: 1.3 };
    for (const t of [0, 10, 100, 1000, 5000]) {
      const p = orbitPosition(el, t);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(100, 6);
    }
  });
  it("zero inclination keeps the orbit flat in XZ", () => {
    for (const t of [0, 50, 333]) {
      expect(orbitPosition(base, t).y).toBeCloseTo(0, 6);
    }
  });
  it("90° inclination puts the orbit in the XY plane (node 0)", () => {
    const el = { ...base, inclination: Math.PI / 2 };
    for (const t of [0, 50, 333]) {
      expect(orbitPosition(el, t).z).toBeCloseTo(0, 6);
    }
  });
  it("node rotates the inclined orbit about Y", () => {
    // i=0 so inclination is a no-op; node 90° maps (x0, 0, z0) -> (z0, 0, -x0)
    const el = { ...base, node: Math.PI / 2 };
    const flat = orbitPosition(base, 40);
    const spun = orbitPosition(el, 40);
    expect(spun.x).toBeCloseTo(flat.z, 6);
    expect(spun.z).toBeCloseTo(-flat.x, 6);
  });
  it("is periodic with period 2π/angularSpeed", () => {
    const el = { ...base, inclination: 0.35, node: 2.1, phase: 0.5 };
    const period = (Math.PI * 2) / el.angularSpeed;
    const a = orbitPosition(el, 12);
    const b = orbitPosition(el, 12 + period);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.y).toBeCloseTo(a.y, 4);
    expect(b.z).toBeCloseTo(a.z, 4);
  });
  it("pins the inclination sign: at θ=90° with i=30°, y = −r·sin i", () => {
    const el = { ...base, inclination: Math.PI / 6 };
    const t = (Math.PI / 2) / el.angularSpeed; // θ = phase(0) + t·ω = 90°
    const p = orbitPosition(el, t);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-50, 6); // −r·sin(30°) = −50: signed, not magnitude
    expect(p.z).toBeCloseTo(100 * Math.cos(Math.PI / 6), 6);
  });
});
