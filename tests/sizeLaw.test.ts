import { describe, expect, it } from "vitest";
import { SUN_RADIUS } from "../src/constants";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { SOLAR_MOONS } from "../src/data/solarMoons";
import { drawnRadius, enlargement, JUPITER_DIAMETER_KM } from "../src/utils/sizeLaw";
import { poleEcliptic } from "../src/utils/poles";

describe("size law", () => {
  it("Jupiter is 22", () => expect(drawnRadius(JUPITER_DIAMETER_KM)).toBe(22));
  it("matches the spec table within 0.05", () => {
    const want: Record<string, number> = {
      saturn: 20.55, uranus: 14.58, neptune: 14.4, earth: 8.37, venus: 8.19, mars: 6.5, mercury: 5.7, ceres: 2.95,
      ganymede: 5.87, titan: 5.82, callisto: 5.67, io: 5.07, moon: 4.97, europa: 4.77, triton: 4.5, phobos: 0.66, deimos: 0.52,
    };
    const got: Record<string, number> = {};
    for (const b of SOLAR_BODIES) got[b.id] = b.size;
    for (const m of SOLAR_MOONS) got[m.id] = m.size;
    for (const [k, v] of Object.entries(want)) expect(Math.abs(got[k] - v), k).toBeLessThan(0.05);
  });
  it("size order equals diameter order and the Sun is largest", () => {
    const all = [...SOLAR_BODIES, ...SOLAR_MOONS];
    const bySize = [...all].sort((a, b) => a.size - b.size).map((x) => x.id);
    const byDiam = [...all].sort((a, b) => a.diameterKm - b.diameterKm).map((x) => x.id);
    expect(bySize).toEqual(byDiam);
    for (const x of all) expect(SUN_RADIUS).toBeGreaterThan(x.size);
  });
  it("Earth is drawn about 1,710x true", () => expect(enlargement(12756.2)).toBeGreaterThan(1600));
});

describe("poleEcliptic", () => {
  it("Earth's pole is the obliquity from the ecliptic north", () => {
    const p = poleEcliptic(0, 90);
    expect((Math.acos(p.z) * 180) / Math.PI).toBeCloseTo(23.43928, 4);
  });
});
