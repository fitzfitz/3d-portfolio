import { describe, it, expect } from "vitest";
import { toroidalDistance } from "../src/utils/toroidal";

describe("toroidalDistance", () => {
  it("computes plain euclidean distance when no wrap is shorter", () => {
    expect(toroidalDistance(0, 0, 3, 4, 250)).toBeCloseTo(5);
  });
  it("wraps across the boundary when that path is shorter", () => {
    // points at x=-245 and x=245 with bounds 250: through the edge = 10, direct = 490
    expect(toroidalDistance(-245, 0, 245, 0, 250)).toBeCloseTo(10);
  });
});
