import { beforeAll, describe, it, expect } from "vitest";
import { bodyReport, BODY_FACTS } from "../src/utils/bodyReports";
import { SOLAR_BODIES, bodyById } from "../src/data/solarSystem";
import { RINGED_GIANT_DENSITY } from "../src/utils/ringOptics";
import { heliocentric } from "../src/utils/bodyPositions";
import { orbitShape } from "../src/utils/ephemeris";
import { ORRERY_TEST_JD, setOrreryEpochJd, orreryJd, formatOrreryDate } from "../src/utils/orreryClock";
import { enlargement } from "../src/utils/sizeLaw";
import { generateScanReport } from "../src/utils/scanReport";

const T = 37;
beforeAll(() => setOrreryEpochJd(ORRERY_TEST_JD));

const speedOf = (r: string) => Number(/ · ([\d.]+) KM\/S/.exec(r)![1]);

describe("bodyReport: the real scan, line by line", () => {
  for (const b of SOLAR_BODIES) {
    it(`${b.id}: name, size, position, orbit, day, facts, date, in order`, () => {
      const lines = bodyReport(b, T).replace(/^SCAN\[[^\]]*\] \/\/ /, "").split(" // ");
      const h = heliocentric(b, T);
      const o = orbitShape(b.orbit.el, orreryJd(T));
      expect(lines[0]).toBe(`${b.name} · ${b.ordinal}`);
      expect(lines[1]).toBe(`DIAMETER ${Math.round(b.diameterKm).toLocaleString("en-US")} KM · DRAWN ${Math.round(enlargement(b.diameterKm)).toLocaleString("en-US")}× TRUE SIZE`);
      expect(lines[2]).toBe(`NOW ${h.rAU.toFixed(2)} AU FROM THE SUN · ${h.speedKmS.toFixed(1)} KM/S`);
      expect(lines[3]).toBe(`ORBIT ${o.a.toFixed(2)} AU (${(o.a * (1 - o.e)).toFixed(2)}–${(o.a * (1 + o.e)).toFixed(2)}) · e ${o.e.toFixed(3)} · i ${Math.abs((o.i * 180) / Math.PI).toFixed(2)}° · YEAR ${(b.facts.yearDays / 365.25).toFixed(2)} EARTH-YR`);
      expect(lines[4]).toBe(`DAY ${b.facts.dayHours.toFixed(1)} H · TILT ${b.obliquityDeg.toFixed(1)}° · MOONS ${b.facts.moons}`);
      expect(BODY_FACTS[b.id].length).toBeGreaterThanOrEqual(2);
      expect(lines[5]).toBe(BODY_FACTS[b.id].join(" · "));
      expect(lines[6]).toBe(`ORRERY DATE ${formatOrreryDate(orreryJd(T))} · SPINS AND MOONS ILLUSTRATIVE`);
      expect(lines).toHaveLength(7);
    });
  }

  it("Earth: drawn about 1,7xx times true size, one moon", () => {
    const r = bodyReport(bodyById("earth"), T);
    expect(r).toContain("DRAWN 1,7");
    expect(r).toContain("MOONS 1");
  });

  it("Mercury moves 1.52 times faster at perihelion than at aphelion", () => {
    const m = bodyById("mercury");
    const { a, e } = orbitShape(m.orbit.el, ORRERY_TEST_JD);
    let peri = 0, aph = 0, lo = Infinity, hi = 0;
    for (let t = 0; t < 101; t += 0.1) {
      const r = heliocentric(m, t).rAU;
      if (r < lo) { lo = r; peri = t; }
      if (r > hi) { hi = r; aph = t; }
    }
    expect(lo).toBeCloseTo(a * (1 - e), 2);
    expect(hi).toBeCloseTo(a * (1 + e), 2);
    expect(speedOf(bodyReport(m, peri)) / speedOf(bodyReport(m, aph))).toBeCloseTo(1.52, 1);
    expect(Math.abs(speedOf(bodyReport(m, peri)) / speedOf(bodyReport(m, aph)) - 1.52)).toBeLessThan(0.02);
  });

  it("Saturn's density is the one the Roche limit uses", () => {
    expect(bodyReport(bodyById("saturn"), T)).toContain(`LESS DENSE THAN WATER (${RINGED_GIANT_DENSITY} G/CM³)`);
  });

  it("names no project and no '-TYPE' namesake any more (spec §5.1)", () => {
    for (const b of SOLAR_BODIES) expect(bodyReport(b, T)).not.toMatch(/-TYPE|SUPABASE|RUANGRAPI|FUXX|EQUILIBRIUM/);
  });

  it("a scan of a non-body id never prints 'undefined' (R19)", () => {
    for (const id of ["fuxx", "ruangrapi", "portfolio", "x", "asteroid_9", "comet_3", "jellyfish", ...Array.from({ length: 300 }, (_, i) => `probe_${i}`)]) {
      const r = generateScanReport(id, T);
      expect(r, id).not.toMatch(/undefined|NaN/);
      expect(r, id).toMatch(/^SCAN\[/);
    }
  });
});
