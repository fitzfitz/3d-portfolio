import { describe, it, expect } from "vitest";
import { worldReport, WORLD_FACTS } from "../src/utils/worldReports";
import { WORLDS } from "../src/data/worlds";
import { equilibriumTempK, fluxEarth, kToC } from "../src/utils/worldPhysics";
import { formatOrbit } from "../src/utils/realUnits";
import { RINGED_GIANT_DENSITY } from "../src/utils/ringOptics";

/** A temperature as the reports print it: whole degrees, a true minus sign. */
const celsius = (c: number) => `${Math.round(c)}`.replace("-", "−") + " °C";
const tEqC = (w: (typeof WORLDS)[number]) => kToC(equilibriumTempK(w.orbit.radius, w.bondAlbedo));

describe("worldReport: every number true where the world orbits", () => {
  for (const w of WORLDS) {
    describe(w.id, () => {
      const report = worldReport(w);

      it("opens with the world's scan label and its namesake type", () => {
        expect(report.startsWith(`SCAN[WORLD_${w.name}] // ${w.namesake.toUpperCase()}-TYPE`)).toBe(true);
      });

      it("states its own equilibrium temperature, from worldPhysics", () => {
        expect(report).toContain(`EQUILIBRIUM ${celsius(tEqC(w))}`);
      });

      it("states its sunlight in Earth's, from worldPhysics", () => {
        expect(report).toContain(`SUNLIGHT ${fluxEarth(w.orbit.radius).toFixed(2)}× EARTH'S`);
      });

      it("ends with the orbit in real units", () => {
        expect(report.endsWith(formatOrbit(w.orbit))).toBe(true);
      });

      it("labels the namesake's own value with the namesake's name, as equilibrium", () => {
        const n = w.namesakeRef;
        expect(report).toContain(`${w.namesake.toUpperCase()} ITSELF (${n.distanceAU.toFixed(2)} AU): ${celsius(n.tempC)} EQUILIBRIUM`);
      });

      it("says its size is compressed, with no number (sizes are P3, not to scale)", () => {
        expect(report).toContain(`${w.namesake.toUpperCase()}-TYPE (SIZE COMPRESSED)`);
      });

      it("states its fixed type facts", () => {
        for (const f of WORLD_FACTS[w.id]) expect(report).toContain(f);
      });

      it("states no number worldPhysics does not produce, apart from namesake data and fixed type facts", () => {
        const allowed = new Set<string>([
          String(Math.abs(Math.round(tEqC(w)))),
          fluxEarth(w.orbit.radius).toFixed(2),
          ...(formatOrbit(w.orbit).match(/\d+(?:\.\d+)?/g) ?? []),
          w.namesakeRef.distanceAU.toFixed(2),
          String(Math.abs(w.namesakeRef.tempC)),
          String(RINGED_GIANT_DENSITY),
        ]);
        for (const n of report.match(/\d+(?:\.\d+)?/g) ?? []) expect(allowed, `${n} in ${report}`).toContain(n);
      });
    });
  }

  it("the ringed giant's density is the one the Roche limit uses", () => {
    expect(worldReport(WORLDS.find((w) => w.id === "w-ringed")!)).toContain(`LESS DENSE THAN WATER (${RINGED_GIANT_DENSITY} G/CM³)`);
  });

  it("the blue giant's bright clouds are ammonia ice, never methane ice (too warm for it there)", () => {
    const blue = WORLDS.find((w) => w.id === "w-blue")!;
    expect(equilibriumTempK(blue.orbit.radius, blue.bondAlbedo)).toBeGreaterThan(80); // methane ice needs ~80 K
    const r = worldReport(blue);
    expect(r).toMatch(/AMMONIA ICE/);
    expect(r).not.toMatch(/CLOUDS (?:ARE|OF) METHANE ICE|METHANE-ICE CLOUDS/);
  });

  it("no ice giant claims to radiate more than it receives (false this close to the star)", () => {
    for (const w of WORLDS) expect(worldReport(w)).not.toMatch(/RADIATES/);
  });
});
