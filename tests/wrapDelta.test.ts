import { describe, it, expect } from "vitest";
import { wrapDelta } from "../src/utils/toroidal";

describe("wrapDelta", () => {
  it("returns the plain delta when no wrap is shorter", () => {
    expect(wrapDelta(0, 100, 250)).toBe(100);
    expect(wrapDelta(100, 0, 250)).toBe(-100);
  });
  it("wraps when crossing the boundary is shorter", () => {
    // from -245 to 245: direct is +490, through the edge is -10
    expect(wrapDelta(-245, 245, 250)).toBe(-10);
    expect(wrapDelta(245, -245, 250)).toBe(10);
  });
  it("is consistent with toroidalDistance", () => {
    const d = wrapDelta(-245, 240, 250);
    expect(Math.abs(d)).toBeCloseTo(15);
  });
});
