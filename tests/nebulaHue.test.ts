import { describe, it, expect } from "vitest";
import { driftedHue } from "../src/utils/nebulaHue";

describe("driftedHue", () => {
  it("returns the base hue at t=0", () => {
    expect(driftedHue(200, 0)).toBeCloseTo(200);
  });
  it("peaks at +amplitude at a quarter period", () => {
    expect(driftedHue(200, 45, 25, 180)).toBeCloseTo(225);
  });
  it("wraps around 360", () => {
    expect(driftedHue(350, 45, 25, 180)).toBeCloseTo(15);
  });
  it("never returns negative values", () => {
    expect(driftedHue(5, 135, 25, 180)).toBeCloseTo(340);
  });
});
