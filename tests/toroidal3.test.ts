import { describe, it, expect } from "vitest";
import { toroidalDistance3 } from "../src/utils/toroidal";

describe("toroidalDistance3", () => {
  it("equals planar distance when heights match", () => {
    expect(toroidalDistance3(0, 0, 5, 3, 4, 5, 250)).toBeCloseTo(5);
  });
  it("includes the vertical component", () => {
    expect(toroidalDistance3(0, 0, 0, 3, 4, 12, 250)).toBeCloseTo(13);
  });
  it("wraps horizontally like toroidalDistance", () => {
    expect(toroidalDistance3(-245, 0, 0, 245, 0, 0, 250)).toBeCloseTo(10);
  });
});
