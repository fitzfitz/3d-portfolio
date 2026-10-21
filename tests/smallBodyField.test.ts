import { describe, it, expect } from "vitest";
import {
  makeBelt, makeTrojans, KIRKWOOD_GAPS_AU, GAP_HALF_WIDTH_AU, BELT_COUNT, BELT_COUNT_LOW, TROJAN_COUNT, COMET_ELEMENTS,
} from "../src/data/smallBodyField";
import { ENCKE, CHURYUMOV, JPL_PLANETS } from "../src/utils/ephemeris";
import { ORRERY_TEST_JD, ORRERY_DAYS_PER_SECOND } from "../src/utils/orreryClock";
import { mulberry32 } from "../src/utils/mulberry32";
import { bodyById } from "../src/data/solarSystem";
import { SUN_COLLIDER } from "../src/data/asteroids";
import { AU } from "../src/constants";
import {
  stepGravity, gravityMode, planetWell, SUN_WELL_G, SUN_WELL_RADIUS, SLINGSHOT_SPEED, type Well,
} from "../src/utils/gravityWell";
import { resolveWorldContact } from "../src/utils/worldCollide";
import { cruiseCap } from "../src/utils/speedCap";

const mod360 = (x: number) => ((x % 360) + 360) % 360;
const wrap180 = (x: number) => mod360(x + 180) - 180;

describe("mulberry32", () => {
  it("is deterministic", () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("makeBelt", () => {
  const belt = makeBelt(BELT_COUNT, 42);
  it("makes the requested count, repeatably", () => {
    expect(belt).toHaveLength(400);
    expect(makeBelt(BELT_COUNT, 42)).toEqual(belt);
    expect(BELT_COUNT_LOW).toBe(200);
    expect(TROJAN_COUNT).toBe(160);
  });
  it("keeps every a in 2.1-3.3 AU and clear of the Kirkwood gaps", () => {
    for (const r of belt) {
      expect(r.el.a).toBeGreaterThanOrEqual(2.1);
      expect(r.el.a).toBeLessThanOrEqual(3.3);
      for (const g of KIRKWOOD_GAPS_AU) expect(Math.abs(r.el.a - g)).toBeGreaterThan(GAP_HALF_WIDTH_AU);
    }
  });
  it("caps e at 0.3 and averages i between 6 and 11 degrees", () => {
    for (const r of belt) { expect(r.el.e).toBeLessThanOrEqual(0.3); expect(r.el.e).toBeGreaterThanOrEqual(0); }
    const mean = belt.reduce((s, r) => s + r.el.i, 0) / belt.length;
    expect(mean).toBeGreaterThan(6);
    expect(mean).toBeLessThan(11);
  });
  it("uses the field epoch and Kepler's third law for n", () => {
    for (const r of belt) {
      expect(r.el.epochJd).toBe(ORRERY_TEST_JD);
      expect(r.el.nDegPerDay).toBeCloseTo(0.9856076686 / r.el.a ** 1.5, 9);
    }
  });
});

describe("makeTrojans", () => {
  const trojans = makeTrojans(TROJAN_COUNT, 1337);
  const jup = JPL_PLANETS.jupiter;
  const T = (ORRERY_TEST_JD - 2451545.0) / 36525;
  const lJup = (jd: number) => jup.L[0] + jup.L[1] * ((jd - 2451545.0) / 36525);
  const lon = (el: { node: number; argPeri: number; M0: number; nDegPerDay: number; epochJd: number }, jd: number) =>
    el.node + el.argPeri + el.M0 + el.nDegPerDay * (jd - el.epochJd);
  const inLobe = (d: number) => Math.abs(Math.abs(d) - 60) <= 25 + 1e-9;
  it("splits evenly between L4 and L5 and keeps e, i bounded", () => {
    expect(trojans).toHaveLength(160);
    expect(trojans.filter((r) => wrap180(lon(r.el, ORRERY_TEST_JD) - lJup(ORRERY_TEST_JD)) > 0)).toHaveLength(80);
    for (const r of trojans) { expect(r.el.e).toBeLessThanOrEqual(0.15); expect(r.el.i).toBeLessThanOrEqual(30); }
  });
  it("stays within 60 +/- 25 degrees of Jupiter, now and 10 000 game seconds later", () => {
    const later = ORRERY_TEST_JD + 10000 * ORRERY_DAYS_PER_SECOND;
    for (const r of trojans) {
      expect(inLobe(wrap180(lon(r.el, ORRERY_TEST_JD) - lJup(ORRERY_TEST_JD)))).toBe(true);
      expect(inLobe(wrap180(lon(r.el, later) - lJup(later)))).toBe(true);
    }
    void T;
  });
  it("shares Jupiter's semi-major axis at J2000", () => {
    for (const r of trojans) expect(r.el.a).toBeCloseTo(jup.a[0], 9);
  });
});

describe("comets", () => {
  it("are Encke and 67P from SBDB", () => {
    expect(COMET_ELEMENTS).toEqual([ENCKE, CHURYUMOV]);
    expect(ENCKE.e).toBeCloseTo(0.8469, 3);
    expect(CHURYUMOV.e).toBeCloseTo(0.6409, 3);
  });
});

const MAX = 10.8, ACCEL = 25.2, DRAG = 0.982;
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
/** Same integrator as tests/gravityWell.test.ts: W held, nose +x, flying past a well at (0,0,0). */
function fly(well: Well, size: number, b: number, x0: number, seconds = 16, dt = 1 / 60) {
  const p = v3(x0, b, 0), v = v3(MAX, 0, 0), G = v3();
  let peak = 0, exit: number | null = null, wasIn = false, minR = Infinity, touched = false;
  for (let i = 0; i < seconds / dt; i++) {
    v.x += ACCEL * dt;
    const l = Math.hypot(v.x, v.y, v.z), cap = cruiseCap(MAX, DRAG, dt);
    if (l > cap) { v.x *= cap / l; v.y *= cap / l; }
    const k = Math.pow(DRAG, dt * 60);
    v.x *= k; v.y *= k; v.z *= k;
    stepGravity(G, p, v, [well], 1, gravityMode(true, false, 0), dt);
    p.x += (v.x + G.x) * dt; p.y += (v.y + G.y) * dt; p.z += (v.z + G.z) * dt;
    if (resolveWorldContact(p, v, well, size)) { touched = true; G.x = 0; G.y = 0; G.z = 0; }
    const r = Math.hypot(p.x, p.y, p.z), s = Math.hypot(v.x + G.x, v.y + G.y, v.z + G.z);
    minR = Math.min(minR, r); peak = Math.max(peak, s);
    if (wasIn && r >= well.radius && exit === null) exit = s;
    wasIn = wasIn || r < well.radius;
  }
  return { peak, exit, minR, touched };
}

describe("the sun's well sits inside Mercury's perihelion", () => {
  const mercuryPerihelionU = JPL_PLANETS.mercury.a[0] * (1 - JPL_PLANETS.mercury.e[0]) * AU;
  const sun: Well = { x: 0, y: 0, z: 0, g: SUN_WELL_G, radius: SUN_WELL_RADIUS, rMin: SUN_COLLIDER.r };
  it("is smaller than 35.36 u", () => {
    expect(mercuryPerihelionU).toBeCloseTo(35.36, 1);
    expect(SUN_WELL_RADIUS).toBeLessThan(mercuryPerihelionU);
    expect(SUN_WELL_RADIUS).toBeGreaterThan(SUN_COLLIDER.r);
  });
  it("a skim at r~30 still crosses SLINGSHOT_SPEED", () => {
    const f = fly(sun, SUN_COLLIDER.r, -30, -60);
    expect(f.touched).toBe(false);
    expect(Math.max(f.peak, f.exit ?? 0)).toBeGreaterThan(SLINGSHOT_SPEED);
  });
});

describe("the slingshot stays earnable at Earth and Jupiter under the unchanged size^2 rule", () => {
  for (const id of ["earth", "jupiter"] as const) {
    it(id, () => {
      const size = bodyById(id).size;
      const w = planetWell({ size });
      let best = 0;
      for (const f of [1.9, 2.1, 2.4, 2.8, 3.1]) {
        const r = fly(w, size, -f * size, -4 * size, 16);
        if (!r.touched) best = Math.max(best, r.peak);
      }
      expect(best).toBeGreaterThan(SLINGSHOT_SPEED);
    });
  }
});
