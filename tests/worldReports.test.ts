import { beforeAll, describe, it, expect } from "vitest";
import { worldReport, BODY_FACTS } from "../src/utils/worldReports";
import { SOLAR_BODIES, bodyById } from "../src/data/solarSystem";
import { equilibriumTempK, fluxEarth, kToC } from "../src/utils/worldPhysics";
import { formatOrbit } from "../src/utils/realUnits";
import { RINGED_GIANT_DENSITY } from "../src/utils/ringOptics";
import { heliocentric } from "../src/utils/bodyPositions";
import { orbitShape } from "../src/utils/ephemeris";
import { ORRERY_TEST_JD, setOrreryEpochJd } from "../src/utils/orreryClock";
import { AU } from "../src/constants";

/** A temperature as the reports print it: whole degrees, a true minus sign. */
const celsius = (c: number) => `${Math.round(c)}`.replace("-", "−") + " °C";
const T = 37;

beforeAll(() => setOrreryEpochJd(ORRERY_TEST_JD));

describe("worldReport: every number true where the body is now", () => {
  for (const b of SOLAR_BODIES) {
    describe(b.id, () => {
      const report = () => worldReport(b, T);
      const r = () => heliocentric(b, T).rAU * AU;

      it("opens with the body's real name and kind, size flagged as enlarged with no number", () => {
        expect(report().startsWith(`SCAN[${b.name}] // ${b.ordinal} (SIZE ENLARGED)`)).toBe(true);
      });

      it("states its equilibrium temperature and sunlight at its live distance (§4.8)", () => {
        expect(report()).toContain(`EQUILIBRIUM ${celsius(kToC(equilibriumTempK(r(), b.bondAlbedo)))}`);
        expect(report()).toContain(`SUNLIGHT ${fluxEarth(r()).toFixed(2)}× EARTH'S`);
        expect(report()).toContain(`NOW ${(r() / AU).toFixed(2)} AU FROM THE SUN`);
      });

      it("ends with the orbit in real units", () => {
        const a = orbitShape(b.orbit.el, ORRERY_TEST_JD + (T * 365.25) / 420).a;
        expect(report().endsWith(formatOrbit(a, b.facts.yearDays))).toBe(true);
      });

      it("states its facts, two real ones", () => {
        expect(BODY_FACTS[b.id].length).toBeGreaterThanOrEqual(2);
        for (const f of BODY_FACTS[b.id]) expect(report()).toContain(f);
      });
    });
  }

  it("Saturn's density is the one the Roche limit uses", () => {
    expect(worldReport(bodyById("saturn"), T)).toContain(`LESS DENSE THAN WATER (${RINGED_GIANT_DENSITY} G/CM³)`);
  });

  it("Mercury's sunlight follows its eccentric orbit: higher at perihelion than at aphelion", () => {
    const { a, e } = orbitShape(bodyById("mercury").orbit.el, ORRERY_TEST_JD);
    const flux = (t: number) => fluxEarth(heliocentric(bodyById("mercury"), t).rAU * AU);
    let lo = Infinity, hi = 0;
    for (let t = 0; t < 101; t += 0.5) { lo = Math.min(lo, flux(t)); hi = Math.max(hi, flux(t)); }
    expect(hi / lo).toBeGreaterThan(2.2);
    expect(hi / lo).toBeLessThanOrEqual(((1 + e) / (1 - e)) ** 2 + 1e-9);
    expect(a).toBeCloseTo(0.387, 3);
  });

  it("names no project and no '-TYPE' namesake any more (spec §5.1)", () => {
    for (const b of SOLAR_BODIES) expect(worldReport(b, T)).not.toMatch(/-TYPE|SUPABASE|RUANGRAPI|FUXX/);
  });
});
