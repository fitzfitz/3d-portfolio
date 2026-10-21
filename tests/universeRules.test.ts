import { afterAll, describe, it, expect } from "vitest";
import * as THREE from "three";
import { AU, GM_SUN, PROGRADE, SHIP_WARP_SPEED, SUN_RADIUS, SYSTEM_RADIUS, VALIDATION_RADIUS, YEAR_S } from "../src/constants";
import { keplerPeriod } from "../src/utils/kepler";
import { CERES, JD_J2000, JPL_PLANETS, orbitShape, planetEcliptic, type JplPlanetElements, type OsculatingElements } from "../src/utils/ephemeris";
import { SOLAR_BODIES, BODY_REACH, bodyById, type SolarBody } from "../src/data/solarSystem";
import { SOLAR_MOONS, CLOSE_UP_HOURS_PER_SECOND, insetDistance, insetGM, insetScale, gmOfMoon, moonSystemReach } from "../src/data/solarMoons";
import { bodyPositionAt } from "../src/utils/bodyPositions";
import { orreryEpochJd, setOrreryEpochJd, ORRERY_TEST_JD } from "../src/utils/orreryClock";
import { poleWorld, spinQuaternion, ringNormal } from "../src/utils/bodySpin";
import { moonOrbitNormal, moonPositionAt, moonQuaternion } from "../src/utils/moonOrbits";
import { drawnRadius, JUPITER_DIAMETER_KM, SIZE_LAW_EXPONENT, SIZE_LAW_JUPITER_R } from "../src/utils/sizeLaw";
import { planetWell, wellStrength, PLANET_WELL_G, PLANET_WELL_RADIUS_FACTOR, WELL_REF_SIZE, SUN_WELL_G, SUN_WELL_RADIUS } from "../src/utils/gravityWell";
import { RING_IN, RING_OUT, URANUS_RING_R, fluidRocheLimit, RINGED_GIANT_DENSITY, RING_ICE_DENSITY } from "../src/utils/ringOptics";
import { COMET_ELEMENTS, makeBelt, makeTrojans, BELT_COUNT, TROJAN_COUNT, KIRKWOOD_GAPS_AU, GAP_HALF_WIDTH_AU } from "../src/data/smallBodyField";
import { orbitWorldPosition } from "../src/utils/beltRocks";
import { HAZE_START } from "../src/utils/edgeHaze";
import { EXPOSURE_MAX, EXPOSURE_MIN, BACKDROP_NET_MAX, SUN_IRRADIANCE_AT_AU, backdropScale, sunIrradiance, targetExposure } from "../src/utils/sunLight";
import { MAX_OCCLUDERS, OCCLUDER_COUNT, CPU_ONLY_BODIES } from "../src/components/canvas/sunShadow";
import { DISPLAY_KNEE_LINEAR, DISPLAY_TOE_GAMMA, displayAlbedoGain } from "../src/utils/displayAlbedo";
import { CRUISE_MAX_FACTOR, cruiseLimit } from "../src/utils/cruise";
import { SECONDS_PER_GAME_SECOND, speedKmS } from "../src/utils/realUnits";
import horizons from "./fixtures/horizons.json";

/**
 * docs/UNIVERSE-RULES.md: the laws of the real Solar System as the scene
 * keeps them (real-solar-system spec §8). Each block names its law. The
 * conventions (P3) are pinned here too, with their numbers, so the doc and
 * the code cannot drift apart. Detail tests live beside each module
 * (ephemeris, solarMoons, bodySpin, ringOptics, smallBodyField, gravityWell);
 * this file is the index a visitor's checklist would read.
 */

type V = { x: number; y: number; z: number };
const D2R = Math.PI / 180;
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (v: V) => Math.hypot(v.x, v.y, v.z);
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const angleDeg = (a: V, b: V) => Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (len(a) * len(b))))) / D2R;
const ECLIPTIC_NORTH: V = { x: 0, y: 1, z: 0 };
const ORIGIN: V = { x: 0, y: 0, z: 0 };

/** Gregorian date to the Julian date at 0h (Fliegel–Van Flandern), proleptic before 1582. */
function jdOf(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045 - 0.5;
}

// ---------------------------------------------------------------------------
// An independent reference for spec §4.2, written apart from src/utils/ephemeris.ts:
// Kepler's equation by bisection (not Newton), and the orbit's P/Q unit vectors
// (not a rotation sequence). JPL's step list: elements at T, ω = ϖ − Ω,
// M = L − ϖ (+ Table 2b's b·T² + c·cos fT + s·sin fT), solve, place, rotate.
// ---------------------------------------------------------------------------

/** E − e·sin E = M by bisection: f is monotone, and |E − M| ≤ e < 1. */
function keplerByBisection(M: number, e: number): number {
  let lo = M - 1, hi = M + 1;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (mid - e * Math.sin(mid) - M > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Heliocentric J2000 ecliptic position (AU) from a, e, I, ω, Ω (deg) and M (deg). */
function placeOnOrbit(a: number, e: number, Ideg: number, wdeg: number, Odeg: number, Mdeg: number): [number, number, number] {
  const M = ((((Mdeg + 180) % 360) + 360) % 360 - 180) * D2R;
  const E = keplerByBisection(M, e);
  const w = wdeg * D2R, O = Odeg * D2R, I = Ideg * D2R;
  const P = [Math.cos(w) * Math.cos(O) - Math.sin(w) * Math.sin(O) * Math.cos(I), Math.cos(w) * Math.sin(O) + Math.sin(w) * Math.cos(O) * Math.cos(I), Math.sin(w) * Math.sin(I)];
  const Q = [-Math.sin(w) * Math.cos(O) - Math.cos(w) * Math.sin(O) * Math.cos(I), -Math.sin(w) * Math.sin(O) + Math.cos(w) * Math.cos(O) * Math.cos(I), Math.cos(w) * Math.sin(I)];
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  return [xp * P[0] + yp * Q[0], xp * P[1] + yp * Q[1], xp * P[2] + yp * Q[2]];
}

function referenceJpl(el: JplPlanetElements, jd: number): [number, number, number] {
  const T = (jd - 2451545.0) / 36525;
  const at = (p: [number, number]) => p[0] + p[1] * T;
  const varpi = at(el.varpi), Om = at(el.Omega);
  let M = at(el.L) - varpi;
  if (el.extra) M += el.extra.b * T * T + el.extra.c * Math.cos(el.extra.f * T * D2R) + el.extra.s * Math.sin(el.extra.f * T * D2R);
  return placeOnOrbit(at(el.a), at(el.e), at(el.I), varpi - Om, Om, M);
}

function referenceOsculating(el: OsculatingElements, jd: number): [number, number, number] {
  return placeOnOrbit(el.a, el.e, el.i, el.argPeri, el.node, el.M0 + el.nDegPerDay * (jd - el.epochJd));
}

const referenceOf = (b: SolarBody, jd: number) => (b.orbit.kind === "jpl" ? referenceJpl(b.orbit.el, jd) : referenceOsculating(b.orbit.el, jd));

/** The scene's own answer for body `b` on date `jd`: the ephemeris through the orrery clock and the world map. */
const savedEpoch = orreryEpochJd();
afterAll(() => setOrreryEpochJd(savedEpoch));
function scenePositionAt(b: SolarBody, jd: number): V {
  setOrreryEpochJd(jd);
  return bodyPositionAt(b, 0, { x: 0, y: 0, z: 0 });
}
/** Orbit normal (r × v direction) of `b` in the world, from its scene positions around `jd`. */
function sceneOrbitNormal(b: SolarBody, jd = ORRERY_TEST_JD): V {
  const p = scenePositionAt(b, jd), q = scenePositionAt(b, jd + 0.01);
  return cross(p, sub(q, p));
}

const SAMPLE_DATES: readonly [string, number][] = [
  ["1000-01-01", jdOf(1000, 1, 1)], ["1500-06-15", jdOf(1500, 6, 15)], ["1900-01-01", jdOf(1900, 1, 1)],
  ["2000-01-01.5 (J2000)", JD_J2000], ["2026-10-20", ORRERY_TEST_JD], ["2500-03-01", jdOf(2500, 3, 1)], ["2900-12-31", jdOf(2900, 12, 31)],
];

describe("L5–L7, L42: every body sits where JPL's approximate method puts it for the orrery date", () => {
  it.each(SOLAR_BODIES.map((b) => [b.id, b] as const))("%s matches an independent reference of spec §4.2 to 1e-6 AU, 1000–2900 AD", (_, b) => {
    for (const [label, jd] of SAMPLE_DATES) {
      const got = scenePositionAt(b, jd);
      const [x, y, z] = referenceOf(b, jd);
      // World = ecliptic (x, z, −y) × AU (spec §4.3).
      const err = Math.hypot(got.x / AU - x, got.y / AU - z, got.z / AU + y);
      expect(err, `${b.id} at ${label}`).toBeLessThan(1e-6);
    }
  });

  // JPL's published Table 2a error bounds, 3000 BC–3000 AD: [longitude ″, latitude ″, radius 1000 km].
  const BOUNDS: Record<string, [number, number, number]> = {
    mercury: [20, 15, 1], venus: [40, 30, 8], earth: [40, 15, 15], mars: [100, 40, 30],
    jupiter: [600, 100, 1000], saturn: [1000, 100, 4000], uranus: [2000, 30, 8000], neptune: [400, 15, 4000],
  };
  const ARCSEC = D2R / 3600, KM_PER_AU = 149_597_870.7;
  it.each(horizons.vectors.filter((v) => v.body !== "ceres").map((v) => [`${v.body} ${v.epoch}`, v] as const))(
    "sanity against JPL Horizons: %s within JPL's own error bound for Table 2a", (_, f) => {
      const got = planetEcliptic(JPL_PLANETS[f.body as keyof typeof JPL_PLANETS], f.jd_tdb, { x: 0, y: 0, z: 0 });
      const [lam, phi, rho] = BOUNDS[f.body];
      const bound = Math.hypot(f.x, f.y, f.z) * Math.hypot(lam * ARCSEC, phi * ARCSEC) + (rho * 1000) / KM_PER_AU;
      expect(Math.hypot(got.x - f.x, got.y - f.y, got.z - f.z)).toBeLessThanOrEqual(bound);
    });

  it("L42: each body flies its own NASA orbit, at the real distance (spec §4.6, within 0.01 AU of Table 1's a)", () => {
    const tableA: Record<string, number> = {
      mercury: 0.3871, venus: 0.72334, earth: 1.0, mars: 1.52371, ceres: 2.76555, jupiter: 5.20289, saturn: 9.53668, uranus: 19.18916, neptune: 30.06992,
    };
    for (const b of SOLAR_BODIES) {
      if (b.orbit.kind === "jpl") expect(b.orbit.el, b.id).toBe(JPL_PLANETS[b.id as keyof typeof JPL_PLANETS]);
      else expect(b.orbit.el, b.id).toBe(CERES);
      expect(Math.abs(orbitShape(b.orbit.el, ORRERY_TEST_JD).a - tableA[b.id]), b.id).toBeLessThan(0.01);
    }
  });
});

describe("L5 Kepler I: orbits are ellipses with the Sun at one focus", () => {
  it("Mercury's orbit is visibly off-centre: r runs a(1 − e) to a(1 + e) over one orbit (35.4–53.7 u)", () => {
    const b = bodyById("mercury");
    const { a, e } = orbitShape(b.orbit.el, ORRERY_TEST_JD);
    let rMin = Infinity, rMax = 0;
    for (let k = 0; k < 2000; k++) {
      const r = len(scenePositionAt(b, ORRERY_TEST_JD + (k / 2000) * 88)) / AU;
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
    }
    expect(rMin / (a * (1 - e))).toBeCloseTo(1, 3);
    expect(rMax / (a * (1 + e))).toBeCloseTo(1, 3);
    expect(e).toBeGreaterThan(0.2);
  });
  it("comets and every belt and Trojan rock are bound ellipses (e < 1)", () => {
    for (const c of COMET_ELEMENTS) expect(c.e).toBeLessThan(1);
    for (const r of [...makeBelt(BELT_COUNT, 42), ...makeTrojans(TROJAN_COUNT, 1337)]) expect(r.el.e).toBeLessThan(1);
  });
});

describe("L6 Kepler II: equal areas in equal times", () => {
  it("Ceres (pure two-body) keeps r × v constant around its orbit", () => {
    const b = bodyById("ceres");
    const h = (jd: number) => { const p = scenePositionAt(b, jd), q = scenePositionAt(b, jd + 1e-3); return len(cross(p, sub(q, p))); };
    const h0 = h(ORRERY_TEST_JD);
    for (let k = 1; k < 24; k++) expect(h(ORRERY_TEST_JD + k * 70) / h0).toBeCloseTo(1, 5);
  });
  it("Mercury moves (1 + e)/(1 − e) ≈ 1.52× faster at perihelion than at aphelion", () => {
    const b = bodyById("mercury");
    const { e } = orbitShape(b.orbit.el, ORRERY_TEST_JD);
    let fast = 0, slow = Infinity;
    for (let k = 0; k < 2000; k++) {
      const jd = ORRERY_TEST_JD + (k / 2000) * 88;
      const v = len(sub(scenePositionAt(b, jd + 1e-3), scenePositionAt(b, jd)));
      fast = Math.max(fast, v); slow = Math.min(slow, v);
    }
    expect(fast / slow).toBeCloseTo((1 + e) / (1 - e), 2);
    expect(fast / slow).toBeGreaterThan(1.5);
  });
});

describe("L7 Kepler III: one GM_SUN, T² = 4π²a³/GM", () => {
  it.each(Object.entries(JPL_PLANETS))("%s: JPL's mean motion (the L rate) gives Kepler's period on GM_SUN within 0.2%", (_, el) => {
    // The 0.2% is Jupiter's and Saturn's own mass, (1 + m/M), which JPL's rates include.
    const jplPeriodS = (360 / el.L[1]) * 36525 * (YEAR_S / 365.25);
    expect(Math.abs(jplPeriodS / keplerPeriod(el.a[0] * AU, GM_SUN) - 1)).toBeLessThan(0.002);
  });
  it("Ceres, both comets and every belt rock run on GM_SUN (SBDB mean motions agree within 0.5%)", () => {
    for (const el of [CERES, ...COMET_ELEMENTS, ...makeBelt(BELT_COUNT, 42).map((r) => r.el)]) {
      const keplerDays = (keplerPeriod(el.a * AU, GM_SUN) / YEAR_S) * 365.25;
      expect(Math.abs(360 / el.nDegPerDay / keplerDays - 1)).toBeLessThan(0.005);
    }
  });
});

describe("L9 one direction, two named backward spinners", () => {
  it.each(SOLAR_BODIES.map((b) => [b.id, b] as const))("%s orbits prograde: counter-clockwise from ecliptic north (+Y)", (_, b) => {
    expect(dot(sceneOrbitNormal(b), ECLIPTIC_NORTH)).toBeGreaterThan(0);
  });
  it("PROGRADE rotation.y turns the same way as the orbits", () => {
    const o = new THREE.Object3D();
    const p = new THREE.Vector3(1, 0, 0);
    o.rotation.y = PROGRADE * 0.01; o.updateMatrixWorld(true);
    const q = p.clone().applyMatrix4(o.matrixWorld);
    expect(dot(cross(p, q), ECLIPTIC_NORTH)).toBeGreaterThan(0);
  });
  it("only Venus and Uranus spin backwards (IAU poles; negative sidereal day; obliquity > 90°)", () => {
    expect(SOLAR_BODIES.filter((b) => b.rotationHours < 0).map((b) => b.id)).toEqual(["venus", "uranus"]);
    expect(SOLAR_BODIES.filter((b) => b.obliquityDeg > 90).map((b) => b.id)).toEqual(["venus", "uranus"]);
    const q = new THREE.Quaternion();
    for (const b of SOLAR_BODIES) {
      // A point on the equator, turned for one close-up second: the sense of the turn about the IAU pole.
      const p0 = new THREE.Vector3(1, 0, 0).applyQuaternion(spinQuaternion(b, 0, q));
      const p1 = new THREE.Vector3(1, 0, 0).applyQuaternion(spinQuaternion(b, 0.01, q));
      expect(Math.sign(p0.clone().cross(p1).dot(poleWorld(b))), b.id).toBe(Math.sign(b.rotationHours));
    }
  });
  it.each(SOLAR_BODIES.map((b) => [b.id, b] as const))("%s's IAU pole sits at NASA's obliquity to its orbit within 0.5°", (_, b) => {
    const ang = angleDeg(poleWorld(b), sceneOrbitNormal(b));
    expect(Math.abs((b.rotationHours < 0 ? 180 - ang : ang) - b.obliquityDeg)).toBeLessThan(0.5);
  });
});

describe("L10 near-coplanar: the real inclinations", () => {
  it.each(SOLAR_BODIES.map((b) => [b.id, b] as const))("%s's orbit is tilted to the ecliptic by JPL's I (within 0.01°)", (_, b) => {
    const I = orbitShape(b.orbit.el, ORRERY_TEST_JD).i / D2R;
    expect(Math.abs(angleDeg(sceneOrbitNormal(b), ECLIPTIC_NORTH) - I)).toBeLessThan(0.01);
  });
  it("every planet lies within 7.01° of the ecliptic (Mercury 7.00°), Ceres 10.6°; no two orbits 12° apart", () => {
    for (const b of SOLAR_BODIES) expect(angleDeg(sceneOrbitNormal(b), ECLIPTIC_NORTH), b.id).toBeLessThan(b.id === "ceres" ? 10.7 : 7.01);
    for (const a of SOLAR_BODIES) for (const b of SOLAR_BODIES) expect(angleDeg(sceneOrbitNormal(a), sceneOrbitNormal(b)), `${a.id}|${b.id}`).toBeLessThan(12);
  });
});

describe("L11–L13 moons: tidally locked, one GM per system, Triton the captured one", () => {
  it("L11: every moon keeps one face (local +X) on its planet", () => {
    const q = new THREE.Quaternion();
    for (const m of SOLAR_MOONS) for (const t of [0, 17, 600]) {
      const toParent = new THREE.Vector3().copy(moonPositionAt(m, t, ORIGIN, { x: 0, y: 0, z: 0 })).negate().normalize();
      expect(new THREE.Vector3(1, 0, 0).applyQuaternion(moonQuaternion(m, t, q)).dot(toParent), `${m.id} t=${t}`).toBeGreaterThan(0.9999);
    }
  });
  it("L12: Triton is the only moon that orbits against its planet's spin", () => {
    for (const m of SOLAR_MOONS) {
      const p = bodyById(m.parent);
      const spin = poleWorld(p).multiplyScalar(Math.sign(p.rotationHours));
      expect(moonOrbitNormal(m, new THREE.Vector3()).dot(spin) < 0, m.id).toBe(m.id === "triton");
    }
  });
  it("L13 / P3: each moon system is one inset, real distance ratios at one scale, one GM (Kepler III within 1%)", () => {
    for (const m of SOLAR_MOONS) {
      const first = SOLAR_MOONS.find((x) => x.parent === m.parent)!;
      expect(insetDistance(m) / insetDistance(first), m.id).toBeCloseTo(m.aKm / first.aKm, 9);
      expect(Math.abs(gmOfMoon(m) / insetGM(m.parent) - 1), m.id).toBeLessThan(0.01);
    }
    expect(insetScale("mars")).toBeCloseTo(0.599, 3); // Ruling R11: every system is compressed to its clearance
  });
});

describe("L14 rings: Saturn's real rings in its equator, Uranus's ε ring, none on Earth", () => {
  it("only Saturn and Uranus wear rings", () => {
    expect(SOLAR_BODIES.filter((b) => b.look.rings).map((b) => [b.id, b.look.rings])).toEqual([["saturn", "saturn"], ["uranus", "uranus"]]);
  });
  it("each ring lies in its planet's equator: its normal is the IAU pole", () => {
    for (const id of ["saturn", "uranus"] as const) {
      const b = bodyById(id);
      expect(ringNormal(b, new THREE.Vector3()).angleTo(poleWorld(b)), id).toBeLessThan(1e-6);
    }
  });
  it("Saturn's rings span 1.24–2.27 R, the A ring's edge at the fluid Roche limit; Uranus's ε ring at 2.00 R", () => {
    expect([RING_IN, RING_OUT]).toEqual([1.24, 2.27]);
    expect(Math.abs(RING_OUT - fluidRocheLimit(RINGED_GIANT_DENSITY, RING_ICE_DENSITY))).toBeLessThan(0.06);
    expect(URANUS_RING_R).toBeCloseTo(2.0, 2);
  });
});

describe("L15 Lagrange points: Jupiter's Trojans at L4 and L5", () => {
  const trojans = makeTrojans(TROJAN_COUNT, 1337);
  const jup = JPL_PLANETS.jupiter;
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  const lJup = (jd: number) => jup.L[0] + jup.L[1] * ((jd - JD_J2000) / 36525);
  const lon = (el: OsculatingElements, jd: number) => el.node + el.argPeri + el.M0 + el.nDegPerDay * (jd - el.epochJd);
  it("half lead and half trail Jupiter by 60° ± 25°, and they share its period, so they stay", () => {
    const later = ORRERY_TEST_JD + 20 * 365.25;
    for (const jd of [ORRERY_TEST_JD, later]) {
      const d = trojans.map((r) => wrap(lon(r.el, jd) - lJup(jd)));
      expect(d.filter((x) => x > 0)).toHaveLength(TROJAN_COUNT / 2);
      for (const x of d) expect(Math.abs(Math.abs(x) - 60)).toBeLessThanOrEqual(25 + 1e-9);
    }
    for (const r of trojans) {
      expect(r.el.a).toBeCloseTo(jup.a[0], 9);
      expect(r.el.nDegPerDay).toBeCloseTo(jup.L[1] / 36525, 12);
    }
  });
});

describe("L18 the edge at 31.3 AU", () => {
  it("SYSTEM_RADIUS 3,600 u (31.3 AU), haze from 3,560, the Worker accepts to 3,800", () => {
    expect(SYSTEM_RADIUS).toBe(3600);
    expect((SYSTEM_RADIUS / AU).toFixed(1)).toBe("31.3");
    expect(HAZE_START).toBe(3560);
    expect(VALIDATION_RADIUS).toBe(3800);
    expect(VALIDATION_RADIUS - SYSTEM_RADIUS).toBeGreaterThanOrEqual(100); // the return burn's worst overshoot at full cruise (spec §6.3)
  });
  it("every body's aphelion plus its well and moons stays short of the haze (Neptune 3,488 + 50 < 3,560)", () => {
    for (const b of SOLAR_BODIES) {
      const { a, e } = orbitShape(b.orbit.el, ORRERY_TEST_JD);
      const reach = Math.max(planetWell(b).radius, BODY_REACH.find((r) => r.key === b.id)!.reach,
        SOLAR_MOONS.some((m) => m.parent === b.id) ? moonSystemReach(b.id) : 0);
      expect(a * (1 + e) * AU + reach, b.id).toBeLessThan(HAZE_START);
    }
  });
});

describe("L19 inverse-square light, a camera that adapts, a backdrop that never glares", () => {
  it("the exposure's ceiling is the edge's own, (3600 / 115)² ≈ 980, so a lit surface reads at its 1 AU brightness out to the edge", () => {
    expect(EXPOSURE_MAX).toBeCloseTo((SYSTEM_RADIUS / AU) ** 2, 9);
    for (let d = AU * Math.sqrt(EXPOSURE_MIN); d <= SYSTEM_RADIUS; d += 25) {
      expect(sunIrradiance(d) * targetExposure(d), `d=${d}`).toBeCloseTo(SUN_IRRADIANCE_AT_AU, 9);
    }
  });
  it("the backdrop's net gain never passes BACKDROP_NET_MAX (8.5, the old 480 u edge's)", () => {
    expect(BACKDROP_NET_MAX).toBe(8.5);
    for (let d = 10; d <= SYSTEM_RADIUS; d += 10) expect(backdropScale(d) * targetExposure(d), `d=${d}`).toBeLessThanOrEqual(BACKDROP_NET_MAX + 1e-9);
  });
});

describe("L20 shadows: fixed occluder slots", () => {
  it("15 of 16 GPU slots: the six bodies with a moon or a ring, then the nine moons; Mercury, Venus and Ceres CPU-only", () => {
    expect(OCCLUDER_COUNT).toBe(15);
    expect(OCCLUDER_COUNT).toBeLessThanOrEqual(MAX_OCCLUDERS);
    expect(CPU_ONLY_BODIES).toEqual(["mercury", "venus", "ceres"]);
  });
});

describe("L35–L36 one size law; the Sun the largest", () => {
  const all = [...SOLAR_BODIES, ...SOLAR_MOONS];
  it("every body and moon is drawn at r = 22 × (D / 142,984 km)^0.4", () => {
    expect([SIZE_LAW_JUPITER_R, JUPITER_DIAMETER_KM, SIZE_LAW_EXPONENT]).toEqual([22, 142_984, 0.4]);
    for (const b of all) expect(b.size, b.id).toBeCloseTo(22 * (b.diameterKm / 142_984) ** 0.4, 12);
    for (const b of all) expect(b.size, b.id).toBe(drawnRadius(b.diameterKm));
  });
  it("L36: drawn size keeps the true order (Ganymede > Titan > Mercury)", () => {
    const byD = [...all].sort((a, b) => b.diameterKm - a.diameterKm);
    for (let i = 1; i < byD.length; i++) expect(byD[i].size, byD[i].id).toBeLessThan(byD[i - 1].size);
    const s = (id: string) => all.find((b) => b.id === id)!.size;
    expect(s("ganymede")).toBeGreaterThan(s("titan"));
    expect(s("titan")).toBeGreaterThan(s("mercury"));
  });
  it("L35: the Sun (24, the exception) outsizes every body; the order is true, the ratio (1.09× Jupiter) compressed", () => {
    expect(SUN_RADIUS).toBe(24);
    for (const b of all) expect(SUN_RADIUS, b.id).toBeGreaterThan(b.size);
    expect(SUN_RADIUS / bodyById("jupiter").size).toBeCloseTo(1.09, 2);
  });
  it("L4/L36: a well's strength goes as size² up to 16 and as size above it (R21); its radius is 3.5 sizes", () => {
    expect([PLANET_WELL_G, WELL_REF_SIZE, PLANET_WELL_RADIUS_FACTOR]).toEqual([3000, 16, 3.5]);
    for (const b of SOLAR_BODIES) {
      const k = b.size / 16;
      expect(wellStrength(b.size), b.id).toBeCloseTo(3000 * (b.size <= 16 ? k * k : k), 9);
      expect(planetWell(b).radius, b.id).toBeCloseTo(3.5 * b.size, 12);
    }
    expect(wellStrength(16 - 1e-9)).toBeCloseTo(wellStrength(16 + 1e-9), 4);
  });
  it("L4: the Sun's well (radius 34, G 3,500) ends inside Mercury's perihelion", () => {
    expect([SUN_WELL_RADIUS, SUN_WELL_G]).toEqual([34, 3500]);
    const { a, e } = orbitShape(bodyById("mercury").orbit.el, ORRERY_TEST_JD);
    expect(SUN_WELL_RADIUS).toBeLessThan(a * (1 - e) * AU);
  });
});

describe("L37 the belt: 2.1–3.3 AU, Kirkwood gaps, mostly empty", () => {
  const belt = makeBelt(BELT_COUNT, 42);
  it("every rock's a is in 2.1–3.3 AU and clear of the Kirkwood gaps", () => {
    for (const r of belt) {
      expect(r.el.a).toBeGreaterThanOrEqual(2.1);
      expect(r.el.a).toBeLessThanOrEqual(3.3);
      for (const g of KIRKWOOD_GAPS_AU) expect(Math.abs(r.el.a - g)).toBeGreaterThan(GAP_HALF_WIDTH_AU);
    }
  });
  it("the rocks sit tens of units apart (nearest neighbours ~30 u, 40 million km)", () => {
    const p = belt.map((r) => orbitWorldPosition(r.el, ORRERY_TEST_JD, { x: 0, y: 0, z: 0 }));
    let sum = 0;
    for (const a of p) sum += Math.min(...p.filter((b) => b !== a).map((b) => len(sub(a, b))));
    expect(sum / p.length).toBeGreaterThan(20);
  });
});

describe("L39–L40 and P3: the clocks and the speed limit", () => {
  it("the orbit clock: 1 s ≈ 20.9 h, a year every 420 s", () => {
    expect(SECONDS_PER_GAME_SECOND / 3600).toBeCloseTo(20.87, 2);
    expect(YEAR_S).toBe(420);
  });
  it("the close-up clock: 1 s ≈ 1.2 h for spins and moon insets (Earth's day 19.9 s)", () => {
    expect(CLOSE_UP_HOURS_PER_SECOND).toBe(1.2);
    expect(bodyById("earth").rotationHours / CLOSE_UP_HOURS_PER_SECOND).toBeCloseTo(19.95, 2);
  });
  it("L39: full cruise is 468 u/s, about 8,100 km/s: 2.7% of light speed", () => {
    expect(cruiseLimit(1e9)).toBe(SHIP_WARP_SPEED * CRUISE_MAX_FACTOR);
    expect(cruiseLimit(1e9)).toBe(468);
    expect(speedKmS(468)).toBeCloseTo(8102, 0);
    expect(speedKmS(468) / 299_792.458).toBeLessThan(0.03);
  });
});

describe("P3 the dark-surface display curve", () => {
  const surfaces = [...SOLAR_BODIES, ...SOLAR_MOONS.filter((m) => !m.shape)];
  it("is the identity from Earth's map median (0.0766) up, with γ ≈ 0.2985 so Ceres gets exactly 3×", () => {
    expect(DISPLAY_KNEE_LINEAR).toBe(0.0766);
    expect(DISPLAY_TOE_GAMMA).toBeCloseTo(0.2985, 4);
    expect(displayAlbedoGain(bodyById("ceres").texelMedianLinear)).toBeCloseTo(3, 9);
    expect(displayAlbedoGain(DISPLAY_KNEE_LINEAR)).toBe(1);
  });
  it("keeps every surface's true order: a darker map is never drawn brighter", () => {
    const shown = (a: number) => a * displayAlbedoGain(a);
    const byA = [...surfaces].sort((a, b) => a.texelMedianLinear - b.texelMedianLinear);
    for (let i = 1; i < byA.length; i++) {
      if (byA[i].texelMedianLinear > byA[i - 1].texelMedianLinear) {
        expect(shown(byA[i].texelMedianLinear), byA[i].id).toBeGreaterThan(shown(byA[i - 1].texelMedianLinear));
      }
    }
  });
});
