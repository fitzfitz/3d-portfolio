import { describe, expect, it } from "vitest";
import { AU } from "../src/constants";
import {
  CERES,
  CHURYUMOV,
  ENCKE,
  JD_J2000,
  JPL_HELD_AFTER_T,
  JPL_PLANETS,
  eclipticToWorld,
  jdFromUnixMs,
  osculatingEcliptic,
  orbitShape,
  planetEcliptic,
  solveKepler,
  unixMsFromJd,
  visVivaKmS,
  type Ecl,
  type JplPlanetElements,
} from "../src/utils/ephemeris";
import horizons from "./fixtures/horizons.json";

const NAMES = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"] as const;
const D2R = Math.PI / 180;
const e0 = (): Ecl => ({ x: 0, y: 0, z: 0 });

/** JPL's step list, transcribed plainly: degrees throughout, no shared code. */
function reference(el: JplPlanetElements, jd: number, held = false): [number, number, number] {
  const T = (jd - 2451545.0) / 36525;
  const Tc = held ? Math.min(T, 10) : T;
  const v = (p: [number, number], t = Tc) => p[0] + p[1] * t;
  const a = v(el.a), e = v(el.e), I = v(el.I), varpi = v(el.varpi), Om = v(el.Omega);
  const L = v(el.L, T);
  const w = varpi - Om;
  let M = L - varpi;
  if (el.extra) {
    const { b, c, s, f } = el.extra;
    M += b * Tc * Tc + c * Math.cos(f * Tc * D2R) + s * Math.sin(f * Tc * D2R);
  }
  M = ((((M + 180) % 360) + 360) % 360) - 180;
  const es = (180 / Math.PI) * e;
  let E = M + es * Math.sin(M * D2R);
  for (let n = 0; n < 100; n++) {
    const dM = M - (E - es * Math.sin(E * D2R));
    const dE = dM / (1 - e * Math.cos(E * D2R));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const xp = a * (Math.cos(E * D2R) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E * D2R);
  const cw = Math.cos(w * D2R), sw = Math.sin(w * D2R);
  const cO = Math.cos(Om * D2R), sO = Math.sin(Om * D2R);
  const cI = Math.cos(I * D2R), sI = Math.sin(I * D2R);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

const jdOf = (y: number, m: number, d: number) => {
  // Gregorian calendar date to JD at 00:00 (Fliegel-Van Flandern)
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045 - 0.5;
};

describe("time helpers", () => {
  it("converts unix ms and JD both ways", () => {
    expect(jdFromUnixMs(0)).toBe(2440587.5);
    expect(jdFromUnixMs(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(JD_J2000, 9);
    expect(unixMsFromJd(jdFromUnixMs(1.7e12))).toBeCloseTo(1.7e12, 0) // a JD double resolves ~0.01 ms;
    expect(JD_J2000).toBe(2451545.0);
  });
});

describe("solveKepler", () => {
  for (const e of [0, 0.2056, 0.85, 0.967]) {
    it(`has a residual below 1e-12 for e = ${e}`, () => {
      for (let k = 0; k < 64; k++) {
        const M = -Math.PI + ((k + 1) / 64) * 2 * Math.PI;
        const E = solveKepler(M, e);
        expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-12);
      }
    });
  }
});

describe("planetEcliptic against a plain transcription of JPL's steps", () => {
  const dates = [jdOf(1000, 1, 1), jdOf(1500, 1, 1), JD_J2000, 2461333.5, jdOf(2500, 1, 1), jdOf(2900, 1, 1)];
  for (const name of NAMES) {
    it(`${name} agrees to 1e-9 AU on six dates`, () => {
      for (const jd of dates) {
        const got = planetEcliptic(JPL_PLANETS[name], jd, e0());
        const [x, y, z] = reference(JPL_PLANETS[name], jd);
        expect(Math.hypot(got.x - x, got.y - y, got.z - z)).toBeLessThan(1e-9);
      }
    });
  }
});

describe("planetEcliptic against JPL Horizons", () => {
  // [longitude arcsec, latitude arcsec, radial 1000 km] from the brief
  const bounds: Record<string, [number, number, number]> = {
    mercury: [20, 15, 1],
    venus: [40, 30, 8],
    earth: [40, 15, 15],
    mars: [100, 40, 30],
    jupiter: [600, 100, 1000],
    saturn: [1000, 100, 4000],
    uranus: [2000, 30, 8000],
    neptune: [400, 15, 4000],
  };
  const KM_PER_AU = 149597870.7;
  const ARCSEC = Math.PI / 180 / 3600;
  for (const f of horizons.vectors.filter((v) => v.body !== "ceres")) {
    it(`${f.body} at ${f.epoch}`, () => {
      const el = JPL_PLANETS[f.body as (typeof NAMES)[number]];
      const got = planetEcliptic(el, f.jd_tdb, e0());
      const d = Math.hypot(got.x - f.x, got.y - f.y, got.z - f.z);
      const [lam, phi, rho] = bounds[f.body];
      const r = Math.hypot(f.x, f.y, f.z);
      const limit = r * Math.hypot(lam * ARCSEC, phi * ARCSEC) + (rho * 1000) / KM_PER_AU;
      expect(d).toBeLessThanOrEqual(limit);
    });
  }
  it("Ceres (SBDB osculating elements) is within 0.01 AU at 2026-10-20", () => {
    const f = horizons.vectors.find((v) => v.body === "ceres" && v.jd_tdb === 2461333.5)!;
    const got = osculatingEcliptic(CERES, f.jd_tdb, e0());
    expect(Math.hypot(got.x - f.x, got.y - f.y, got.z - f.z)).toBeLessThan(0.01);
  });
});

describe("Kepler III", () => {
  for (const name of NAMES) {
    it(`${name}: the L-rate period matches 365.25 a^1.5 within 0.2%`, () => {
      const el = JPL_PLANETS[name];
      const fromRate = (36525 * 360) / el.L[1];
      expect(Math.abs(fromRate / (365.25 * el.a[0] ** 1.5) - 1)).toBeLessThan(0.002);
    });
  }
});

describe("frame", () => {
  it("maps ecliptic axes to world axes, scaled by AU", () => {
    const w = { x: 0, y: 0, z: 0 };
    expect(eclipticToWorld({ x: 1, y: 0, z: 0 }, w)).toEqual({ x: AU, y: 0, z: 0 });
    const y = { ...eclipticToWorld({ x: 0, y: 1, z: 0 }, w) };
    expect(y.x).toBeCloseTo(0, 12);
    expect(y.y).toBeCloseTo(0, 12);
    expect(y.z).toBeCloseTo(-AU, 12);
    const z = { ...eclipticToWorld({ x: 0, y: 0, z: 1 }, w) };
    expect(z.x).toBeCloseTo(0, 12);
    expect(z.y).toBeCloseTo(AU, 12);
    expect(z.z).toBeCloseTo(0, 12);
  });
  for (const name of NAMES) {
    it(`${name} moves prograde about +Y`, () => {
      const at = (jd: number) => {
        const c = planetEcliptic(JPL_PLANETS[name], jd, e0());
        return eclipticToWorld(c, { x: 0, y: 0, z: 0 });
      };
      const jd = 2461333.5;
      const p = at(jd);
      const a = at(jd - 1);
      const b = at(jd + 1);
      const v = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      // (r x v).y = z*vx - x*vz
      expect(p.z * v.x - p.x * v.z).toBeGreaterThan(0);
    });
  }
});

describe("elements held past 3000 AD (T > JPL_HELD_AFTER_T)", () => {
  const jd3500 = jdOf(3500, 1, 1);
  for (const name of NAMES) {
    it(`${name} is finite, matches the clamped-T reference, and still moves`, () => {
      const el = JPL_PLANETS[name];
      expect((jd3500 - JD_J2000) / 36525).toBeGreaterThan(JPL_HELD_AFTER_T);
      const got = planetEcliptic(el, jd3500, e0());
      expect(Number.isFinite(got.x + got.y + got.z)).toBe(true);
      const [x, y, z] = reference(el, jd3500, true);
      expect(Math.hypot(got.x - x, got.y - y, got.z - z)).toBeLessThan(1e-9);
      const next = planetEcliptic(el, jd3500 + 1, e0());
      expect(Math.hypot(next.x - got.x, next.y - got.y, next.z - got.z)).toBeGreaterThan(1e-6);
    });
  }
});

describe("osculating and shape helpers", () => {
  it("returns the epoch position consistent with the elements (r between q and Q)", () => {
    for (const el of [CERES, ENCKE, CHURYUMOV]) {
      const p = osculatingEcliptic(el, el.epochJd + 500, e0());
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r).toBeGreaterThanOrEqual(el.a * (1 - el.e) - 1e-9);
      expect(r).toBeLessThanOrEqual(el.a * (1 + el.e) + 1e-9);
    }
  });
  it("is periodic after one orbit", () => {
    const period = 360 / ENCKE.nDegPerDay;
    const p = osculatingEcliptic(ENCKE, ENCKE.epochJd + 100, e0());
    const q = osculatingEcliptic(ENCKE, ENCKE.epochJd + 100 + period, e0());
    expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-9);
  });
  it("orbitShape reports AU and radians", () => {
    const s = orbitShape(CERES, CERES.epochJd);
    expect(s.a).toBeCloseTo(2.765552595, 9);
    expect(s.i).toBeCloseTo(10.58802780183462 * D2R, 12);
    expect(s.node).toBeCloseTo(80.24862682043221 * D2R, 12);
    expect(s.argPeri).toBeCloseTo(73.29421453021587 * D2R, 12);
    const m = orbitShape(JPL_PLANETS.mars, JD_J2000);
    expect(m.a).toBeCloseTo(1.52371243, 9);
    expect(m.argPeri).toBeCloseTo((-23.91744784 - 49.71320984) * D2R, 12);
  });
  it("visVivaKmS is Earth's mean speed on a circle and slower at aphelion", () => {
    expect(visVivaKmS(1, 1)).toBeCloseTo(29.7847, 9);
    expect(visVivaKmS(1.0167, 1)).toBeLessThan(29.7847);
    expect(visVivaKmS(0.9833, 1)).toBeGreaterThan(29.7847);
  });
});
