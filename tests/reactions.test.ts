import { describe, it, expect } from "vitest";
import { proximity, decay, damp, dampVec, awayFrom } from "../src/utils/reactions";

describe("proximity", () => {
  it("is 1 at or inside inner and 0 at or beyond outer", () => {
    expect(proximity(0, 10, 30)).toBe(1);
    expect(proximity(10, 10, 30)).toBe(1);
    expect(proximity(30, 10, 30)).toBe(0);
    expect(proximity(99, 10, 30)).toBe(0);
  });
  it("falls monotonically between inner and outer", () => {
    let prev = 1;
    for (let d = 10; d <= 30; d += 0.5) {
      const p = proximity(d, 10, 30);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});

describe("decay", () => {
  it("is the per-step factor damp applies", () => {
    expect(decay(1, 1)).toBeCloseTo(0.5);
    expect(decay(0, 1)).toBe(0);
  });
});

describe("damp", () => {
  it("closes half the gap per half-life", () => {
    expect(damp(0, 10, 1, 1)).toBeCloseTo(5);
  });
  it("is frame-rate independent", () => {
    const one = damp(0, 10, 0.5, 0.1);
    let ten = 0;
    for (let i = 0; i < 10; i++) ten = damp(ten, 10, 0.5, 0.01);
    expect(ten).toBeCloseTo(one, 6);
  });
  it("never overshoots, even for a huge dt after a frozen frame", () => {
    const v = damp(0, 10, 0.25, 5);
    expect(v).toBeLessThanOrEqual(10);
    expect(v).toBeGreaterThan(9.99);
  });
  it("snaps to the target when the half-life is zero", () => {
    expect(damp(3, 7, 0, 0.016)).toBe(7);
  });
});

describe("dampVec", () => {
  it("moves each axis like damp", () => {
    const v = { x: 0, y: 10, z: -4 };
    dampVec(v, { x: 10, y: 0, z: 0 }, 1, 1);
    expect(v).toEqual({ x: 5, y: 5, z: -2 });
  });
});

describe("awayFrom", () => {
  it("returns the unit direction from `from` toward `to`", () => {
    const o = { x: 0, y: 0, z: 0 };
    awayFrom(o, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 });
    expect(o.x).toBeCloseTo(0.6);
    expect(o.y).toBeCloseTo(0);
    expect(o.z).toBeCloseTo(0.8);
  });
  it("falls back to straight up when the points coincide", () => {
    const o = { x: 9, y: 9, z: 9 };
    awayFrom(o, { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 });
    expect(o).toEqual({ x: 0, y: 1, z: 0 });
  });
});
