import { describe, it, expect } from "vitest";
import { DOT_PX, needsDot, projectedRadiusPx } from "../src/utils/bodyDots";

const FOV = Math.PI / 3;

describe("needsDot: a body under 2 px across is drawn as a dot (spec §6.2)", () => {
  it("Jupiter-sized at 3000 u is still a disc; Ceres-sized there is a dot", () => {
    expect(needsDot(22, 3000, FOV, 800)).toBe(false);
    expect(needsDot(2.95, 3000, FOV, 800)).toBe(true);
  });

  it("switches where the projected radius crosses 1 px (a 2 px disc)", () => {
    // f·r/√(d² − r²) = 1 at d = r·√(1 + f²), f = (H/2)/tan(fov/2).
    const f = 400 / Math.tan(FOV / 2);
    const d = 5 * Math.sqrt(1 + f * f);
    expect(projectedRadiusPx(5, d, FOV, 800)).toBeCloseTo(1, 9);
    expect(needsDot(5, d * 0.999, FOV, 800)).toBe(false);
    expect(needsDot(5, d * 1.001, FOV, 800)).toBe(true);
  });

  it("is never a dot from inside or at the surface", () => {
    expect(needsDot(8, 8, FOV, 800)).toBe(false);
    expect(needsDot(8, 3, FOV, 800)).toBe(false);
  });

  it("a taller viewport or a narrower lens keeps the disc further out", () => {
    expect(needsDot(4, 3000, FOV, 800)).toBe(true);
    expect(needsDot(4, 3000, FOV, 1600)).toBe(false);
    expect(needsDot(4, 3000, FOV / 2, 800)).toBe(false);
  });

  it("the dot is 2 px across: the disc it stands in for", () => {
    expect(DOT_PX).toBe(2);
  });
});
