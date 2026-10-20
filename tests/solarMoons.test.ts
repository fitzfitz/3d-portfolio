import { describe, expect, it } from "vitest";
import { bodyById } from "../src/data/solarSystem";
import {
  CLOSE_UP_HOURS_PER_SECOND, gmOfMoon, insetDistance, insetGM, insetPeriod, insetScale, moonSystemReach, SOLAR_MOONS,
} from "../src/data/solarMoons";
import type { BodyId } from "../src/data/bodyIds";

const sys = (p: BodyId) => SOLAR_MOONS.filter((m) => m.parent === p);
const moon = (id: string) => SOLAR_MOONS.find((m) => m.id === id)!;

describe("moon insets", () => {
  it("periods are on the close-up clock", () => {
    for (const m of SOLAR_MOONS) expect(insetPeriod(m)).toBeCloseTo(m.periodHours / CLOSE_UP_HOURS_PER_SECOND, 9);
  });
  it("GM agrees within 1% for every moon of a system", () => {
    for (const p of new Set(SOLAR_MOONS.map((m) => m.parent))) {
      for (const m of sys(p)) expect(Math.abs(gmOfMoon(m) / insetGM(p) - 1), m.id).toBeLessThan(0.01);
    }
  });
  it("Galilean period ratios keep the Laplace resonance", () => {
    const [io, eu, ga] = ["io", "europa", "ganymede"].map((i) => insetPeriod(moon(i)));
    expect(Math.abs(eu / io / 2.007 - 1)).toBeLessThan(0.005);
    expect(Math.abs(ga / io / 4.044 - 1)).toBeLessThan(0.005);
  });
  it("Triton is the only retrograde moon", () => {
    expect(SOLAR_MOONS.filter((m) => m.retrograde).map((m) => m.id)).toEqual(["triton"]);
  });
  it("innermost moons meet their required distance; scales as expected", () => {
    for (const p of new Set(SOLAR_MOONS.map((m) => m.parent))) {
      const inner = sys(p).sort((a, b) => a.aKm - b.aKm)[0];
      const size = bodyById(p).size;
      let need = 1.5 * (size + inner.size);
      if (p === "saturn") need = Math.max(need, 2.27 * size + inner.size + 2);
      expect(insetDistance(inner)).toBeGreaterThanOrEqual(need - 1e-9);
    }
    // The brief expected exactly 1, but min(1, required / real) gives 0.599 for Mars (Phobos
    // real 17.9 u vs required 10.7 u); the formula is kept and the conflict reported.
    expect(insetScale("mars")).toBeCloseTo(0.599, 2);
    expect(insetScale("earth")).toBeCloseTo(0.04, 2);
    expect(insetScale("jupiter")).toBeCloseTo(0.313, 2);
    expect(insetScale("saturn")).toBeCloseTo(0.126, 1);
    expect(insetScale("neptune")).toBeCloseTo(0.138, 2);
  });
  it("system reach is outermost distance plus size", () => {
    const c = moon("callisto");
    expect(moonSystemReach("jupiter")).toBeCloseTo(insetDistance(c) + c.size);
  });
});
