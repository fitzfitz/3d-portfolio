import { describe, it, expect } from "vitest";
import { AU } from "../src/constants";
import { fluxEarth, equilibriumTempK, kToC } from "../src/utils/worldPhysics";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { orbitShape, JD_J2000 } from "../src/utils/ephemeris";

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
  // One definition for every body: its equilibrium (black-body) temperature
  // at its semi-major axis with its real Bond albedo, the NSSDC fact sheets'
  // "black-body temperature" (K), within 3 K (~1%: the sheets round the
  // albedos; Venus's 226.6 K implies a Bond albedo of ~0.77 against the
  // roster's 0.76). Ceres has no fact sheet: ~166 K, computed.
  const NSSDC_BLACK_BODY_K: Record<string, number> = {
    mercury: 439.6, venus: 226.6, earth: 254.0, mars: 209.8, ceres: 166,
    jupiter: 109.9, saturn: 81.1, uranus: 58.2, neptune: 46.6,
  };
  it.each(SOLAR_BODIES.map((b) => [b.id, b] as const))("%s's equilibrium temperature matches NSSDC's black-body value", (id, b) => {
    const a = orbitShape(b.orbit.el, JD_J2000).a;
    expect(Math.abs(equilibriumTempK(a * AU, b.bondAlbedo) - NSSDC_BLACK_BODY_K[id])).toBeLessThan(3);
  });
});
