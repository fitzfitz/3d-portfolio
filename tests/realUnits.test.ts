import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { planets, SYSTEM_RADIUS, SHIP_MAX_SPEED, SHIP_WARP_SPEED, GM_SUN } from "../src/constants";
import { KM_PER_UNIT, SECONDS_PER_GAME_SECOND, speedKmS, distanceAU, earthYears, formatOrbit, SIZE_ENLARGEMENT, ORRERY_NOTE } from "../src/utils/realUnits";

// These are the numbers in docs/UNIVERSE-RULES.md "Units". Change both together.
describe("real units", () => {
  it("one game second is 20.9 hours", () => {
    expect(SECONDS_PER_GAME_SECOND / 3600).toBeCloseTo(20.87, 2);
  });
  it("GM_SUN in real units is the Sun's own 1.327e20 m^3/s^2", () => {
    const gmReal = GM_SUN * (KM_PER_UNIT * 1000) ** 3 / SECONDS_PER_GAME_SECOND ** 2;
    expect(gmReal / 1.327e20).toBeCloseTo(1, 2);
  });
  it("Ruangrapi moves at Earth's 29.8 km/s", () => {
    const o = planets[0].orbit;
    expect(speedKmS(o.radius * o.angularSpeed)).toBeCloseTo(29.78, 1);
  });
  it("the ship cruises at 187 km/s and warps at 675 km/s, under 1% of light speed", () => {
    expect(Math.round(speedKmS(SHIP_MAX_SPEED))).toBe(187);
    expect(Math.round(speedKmS(SHIP_WARP_SPEED))).toBe(675);
    expect(speedKmS(SHIP_WARP_SPEED) / 299_792.458).toBeLessThan(0.01);
  });
  it("orbits read in AU and Earth years", () => {
    expect(distanceAU(115)).toBe(1);
    expect(earthYears(420)).toBeCloseTo(1, 9);
    expect(formatOrbit(planets[0].orbit)).toBe("ORBIT 1.00 AU · YEAR 1.00 EARTH-YR");
    expect(formatOrbit(planets[1].orbit)).toBe("ORBIT 1.30 AU · YEAR 1.49 EARTH-YR");
    expect(formatOrbit(planets[2].orbit)).toBe("ORBIT 1.61 AU · YEAR 2.04 EARTH-YR");
  });
  it("the orrery note states the real enlargement and clock", () => {
    expect(SIZE_ENLARGEMENT).toBe(290);
    expect(ORRERY_NOTE).toBe("TWO ORRERY CONVENTIONS: PLANETS DRAWN ~290× JUPITER'S SIZE · 1 S ≈ 21 H, MOON SYSTEMS ON THEIR OWN SLOWER CLOCK");
  });
});

describe("sector range readout", () => {
  it("the sector is 4.35 AU across", () => {
    expect(distanceAU(SYSTEM_RADIUS * 2).toFixed(2)).toBe("6.96");
  });
});

describe("docs/UNIVERSE-RULES.md Units table (spec F13)", () => {
  const doc = readFileSync(new URL("../docs/UNIVERSE-RULES.md", import.meta.url), "utf8");
  const row = (needle: string) => {
    const line = doc.split("\n").find((l) => l.startsWith("|") && l.includes(needle));
    expect(line, `Units table row containing "${needle}"`).toBeDefined();
    return line!;
  };
  it("lists the readouts the code produces", () => {
    expect(row("20.9 hours")).toContain((SECONDS_PER_GAME_SECOND / 3600).toFixed(1) + " hours");
    const o = planets[0].orbit;
    expect(row("29.8 km/s")).toContain(speedKmS(o.radius * o.angularSpeed).toFixed(1) + " km/s");
    expect(row("187 km/s")).toContain(speedKmS(SHIP_MAX_SPEED).toFixed(0) + " km/s");
    expect(row("675 km/s")).toContain(speedKmS(SHIP_WARP_SPEED).toFixed(0) + " km/s");
    expect(row("0.23%")).toContain(((speedKmS(SHIP_WARP_SPEED) / 299_792.458) * 100).toFixed(2) + "%");
  });
});
