import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SYSTEM_RADIUS, SHIP_MAX_SPEED, SHIP_WARP_SPEED, GM_SUN } from "../src/constants";
import { SIZE_LAW_JUPITER_R, JUPITER_DIAMETER_KM, enlargement } from "../src/utils/sizeLaw";
import { visVivaKmS } from "../src/utils/ephemeris";
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
  it("a circular 1 AU orbit on GM_SUN moves at Earth's mean 29.8 km/s, as vis-viva says", () => {
    const v = Math.sqrt(GM_SUN / 115);
    expect(speedKmS(v)).toBeCloseTo(29.78, 1);
    expect(visVivaKmS(1, 1)).toBeCloseTo(speedKmS(v), 1);
  });
  it("the ship cruises at 187 km/s and warps at 675 km/s, under 1% of light speed", () => {
    expect(Math.round(speedKmS(SHIP_MAX_SPEED))).toBe(187);
    expect(Math.round(speedKmS(SHIP_WARP_SPEED))).toBe(675);
    expect(speedKmS(SHIP_WARP_SPEED) / 299_792.458).toBeLessThan(0.01);
  });
  it("orbits read in AU and Earth years", () => {
    expect(distanceAU(115)).toBe(1);
    expect(earthYears(420)).toBeCloseTo(1, 9);
    expect(formatOrbit(1.00000261, 365.256)).toBe("ORBIT 1.00 AU · YEAR 1.00 EARTH-YR");
    expect(formatOrbit(1.52371034, 686.98)).toBe("ORBIT 1.52 AU · YEAR 1.88 EARTH-YR");
    expect(formatOrbit(30.06992276, 60189)).toBe("ORBIT 30.07 AU · YEAR 164.79 EARTH-YR");
  });
  it("the orrery note states the real enlargement, the clock and the dark-surface display curve", () => {
    // Jupiter at the size law's 22 u (Task 11 replaces the note).
    expect(SIZE_ENLARGEMENT).toBe(400);
    expect(SIZE_ENLARGEMENT).toBe(Math.round(enlargement(JUPITER_DIAMETER_KM) / 10) * 10);
    expect(SIZE_LAW_JUPITER_R).toBe(22); // realUnits restates it (import cycle)
    expect(ORRERY_NOTE).toBe("THREE ORRERY CONVENTIONS: PLANETS DRAWN ~400× JUPITER'S SIZE · 1 S ≈ 21 H, MOON SYSTEMS ON THEIR OWN SLOWER CLOCK · DARK SURFACES DRAWN BRIGHTER THAN TRUE");
  });
});

describe("sector range readout", () => {
  it("the sector is 62.61 AU across (SYSTEM_RADIUS 3600)", () => {
    expect(distanceAU(SYSTEM_RADIUS * 2).toFixed(2)).toBe("62.61");
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
    expect(row("29.8 km/s")).toContain(speedKmS(Math.sqrt(GM_SUN / 115)).toFixed(1) + " km/s");
    expect(row("187 km/s")).toContain(speedKmS(SHIP_MAX_SPEED).toFixed(0) + " km/s");
    expect(row("675 km/s")).toContain(speedKmS(SHIP_WARP_SPEED).toFixed(0) + " km/s");
    expect(row("0.23%")).toContain(((speedKmS(SHIP_WARP_SPEED) / 299_792.458) * 100).toFixed(2) + "%");
  });
});
