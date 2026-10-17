import { describe, it, expect } from "vitest";
import { AU } from "../src/constants";
import { fluxEarth, equilibriumTempK, kToC } from "../src/utils/worldPhysics";
import { WORLDS } from "../src/data/worlds";

describe("world physics", () => {
  it("flux is inverse-square in AU", () => {
    expect(fluxEarth(AU)).toBeCloseTo(1, 12);
    expect(fluxEarth(2 * AU)).toBeCloseTo(0.25, 12);
  });
  it("equilibrium temperature: Earth-like at 1 AU, falls as 1/sqrt(r)", () => {
    expect(equilibriumTempK(AU, 0)).toBeCloseTo(278.6, 1);
    expect(equilibriumTempK(4 * AU, 0)).toBeCloseTo(139.3, 1);
  });
  // Real Ceres (2.77 AU, A 0.034): about 166 K
  it("matches Ceres at its real distance", () => {
    expect(equilibriumTempK(2.77 * AU, 0.034)).toBeCloseTo(166, 0);
  });
  it("converts kelvin to celsius", () => {
    expect(kToC(273.15)).toBe(0);
    expect(kToC(0)).toBe(-273.15);
  });
  // One definition for every namesake: the real planet's equilibrium
  // (black-body) temperature at its real distance, with its real Bond albedo.
  it.each(WORLDS.map((w) => [w.namesake, w] as const))("%s's reference temperature is its equilibrium temperature", (_, w) => {
    const computed = kToC(equilibriumTempK(w.namesakeRef.distanceAU * AU, w.bondAlbedo));
    expect(Math.abs(computed - w.namesakeRef.tempC)).toBeLessThan(1);
  });
});
