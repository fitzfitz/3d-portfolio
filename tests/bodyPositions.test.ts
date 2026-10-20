import { beforeAll, describe, it, expect } from "vitest";
import { BODY_IDS, type BodyId } from "../src/data/bodyIds";
import { SOLAR_BODIES, bodyById } from "../src/data/solarSystem";
import { eclipticToWorld, orbitShape, osculatingEcliptic, planetEcliptic, type Ecl } from "../src/utils/ephemeris";
import { ORRERY_DAYS_PER_SECOND, ORRERY_TEST_JD, setOrreryEpochJd } from "../src/utils/orreryClock";
import { bodyPositionAt, heliocentric, updateBodies } from "../src/utils/bodyPositions";
import { bodySlot, occluders, OCCLUDER_SLOTS } from "../src/components/canvas/sunShadow";
import { clearScannables, nearestScannable } from "../src/utils/scannables";
import { AU } from "../src/constants";

type V = { x: number; y: number; z: number };

beforeAll(() => setOrreryEpochJd(ORRERY_TEST_JD));

/** The reference: the ephemeris straight into the world frame. */
function expected(id: BodyId, jd: number): V {
  const b = bodyById(id);
  const ecl: Ecl = { x: 0, y: 0, z: 0 };
  if (b.orbit.kind === "jpl") planetEcliptic(b.orbit.el, jd, ecl);
  else osculatingEcliptic(b.orbit.el, jd, ecl);
  return eclipticToWorld(ecl, { x: 0, y: 0, z: 0 });
}

describe("bodyPositionAt: the ephemeris at the orrery date", () => {
  it("equals eclipticToWorld(planetEcliptic(...)) at ORRERY_TEST_JD for every body", () => {
    for (const b of SOLAR_BODIES) {
      const got = bodyPositionAt(b, 0, { x: NaN, y: NaN, z: NaN });
      const want = expected(b.id, ORRERY_TEST_JD);
      expect(got.x, b.id).toBeCloseTo(want.x, 9);
      expect(got.y, b.id).toBeCloseTo(want.y, 9);
      expect(got.z, b.id).toBeCloseTo(want.z, 9);
    }
  });

  it("advances on the orrery clock: game seconds become days", () => {
    const t = 300;
    const got = bodyPositionAt(bodyById("mars"), t, { x: 0, y: 0, z: 0 });
    const want = expected("mars", ORRERY_TEST_JD + t * ORRERY_DAYS_PER_SECOND);
    expect(got.x).toBeCloseTo(want.x, 9);
    expect(got.z).toBeCloseTo(want.z, 9);
  });

  it("writes into `out` and returns it", () => {
    const out = { x: 0, y: 0, z: 0 };
    expect(bodyPositionAt(bodyById("earth"), 0, out)).toBe(out);
  });
});

describe("updateBodies: the one writer of `bodies`", () => {
  it("writes all nine ids and no others", () => {
    const out = Object.fromEntries([...BODY_IDS, "w-rock", "ruangrapi"].map((id) => [id, { x: NaN, y: NaN, z: NaN }]));
    const keys = Object.keys(out);
    updateBodies(0, out as Record<BodyId, V>);
    expect(Object.keys(out)).toEqual(keys);
    for (const id of BODY_IDS) {
      const want = expected(id, ORRERY_TEST_JD);
      expect(out[id].x, id).toBeCloseTo(want.x, 9);
      expect(out[id].y, id).toBeCloseTo(want.y, 9);
      expect(out[id].z, id).toBeCloseTo(want.z, 9);
    }
    expect(out["w-rock"].x).toBeNaN();
    expect(out.ruangrapi.x).toBeNaN();
  });

  it("gives the outermost body no slot; the rest hold slots 0.. in BODY_IDS order", () => {
    const outermost = SOLAR_BODIES.reduce((a, b) =>
      orbitShape(b.orbit.el, ORRERY_TEST_JD).a > orbitShape(a.orbit.el, ORRERY_TEST_JD).a ? b : a);
    expect(outermost.id).toBe("neptune");
    expect(bodySlot("neptune")).toBe(-1);
    const slotted = BODY_IDS.filter((id) => id !== outermost.id);
    slotted.forEach((id, i) => expect(bodySlot(id), id).toBe(i));
    expect(OCCLUDER_SLOTS.bodies).toEqual({ first: 0, count: 8 });
  });

  it("places each slotted body's occluder at its centre with its equatorial radius", () => {
    const out = Object.fromEntries(BODY_IDS.map((id) => [id, { x: 0, y: 0, z: 0 }])) as Record<BodyId, V>;
    updateBodies(0, out);
    for (const id of BODY_IDS) {
      const s = bodySlot(id);
      if (s < 0) continue;
      expect(occluders[s].x, id).toBe(out[id].x);
      expect(occluders[s].z, id).toBe(out[id].z);
      expect(occluders[s].r, id).toBe(bodyById(id).size);
    }
  });

  it("registers each body as a scannable by its real name, measured from its surface", () => {
    clearScannables();
    const out = Object.fromEntries(BODY_IDS.map((id) => [id, { x: 0, y: 0, z: 0 }])) as Record<BodyId, V>;
    updateBodies(0, out);
    const c = out.ceres, r = bodyById("ceres").size;
    const hit = nearestScannable(c.x + r + 1, c.y, c.z, 5);
    expect(hit?.id).toBe("ceres");
    expect(hit?.label).toBe("CERES");
    expect(hit?.dist).toBeCloseTo(1, 9);
  });
});

describe("heliocentric: live distance and speed (§4.8)", () => {
  it("puts Earth near 1 AU at about 29.8 km/s", () => {
    const h = heliocentric(bodyById("earth"), 0);
    expect(h.rAU).toBeGreaterThan(0.983);
    expect(h.rAU).toBeLessThan(1.017);
    expect(h.speedKmS).toBeGreaterThan(29.2);
    expect(h.speedKmS).toBeLessThan(30.3);
  });

  it("is the length of bodyPositionAt over AU", () => {
    for (const b of SOLAR_BODIES) {
      const p = bodyPositionAt(b, 0, { x: 0, y: 0, z: 0 });
      expect(heliocentric(b, 0).rAU, b.id).toBeCloseTo(Math.hypot(p.x, p.y, p.z) / AU, 9);
    }
  });

  it("follows Mercury's eccentric orbit: between perihelion and aphelion", () => {
    const { a, e } = orbitShape(bodyById("mercury").orbit.el, ORRERY_TEST_JD);
    for (let t = 0; t < 101; t += 10) {
      const r = heliocentric(bodyById("mercury"), t).rAU;
      expect(r).toBeGreaterThanOrEqual(a * (1 - e) - 1e-6);
      expect(r).toBeLessThanOrEqual(a * (1 + e) + 1e-6);
    }
  });
});
