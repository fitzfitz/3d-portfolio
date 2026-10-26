import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CRUISE_ACCEL, CRUISE_FREE_REF, CRUISE_MAX_FACTOR, cruiseLimit, freeDistance, stepCruise, raceWarpSpeed, clampRaceVelocity, shipWarpSpeed,
} from "../src/utils/cruise";
import { SUN_RADIUS, SYSTEM_RADIUS, SHIP_WARP_SPEED } from "../src/constants";
import { BODY_REACH, bodyById } from "../src/data/solarSystem";
import { bodyPositionAt } from "../src/utils/bodyPositions";
import { ORRERY_TEST_JD, orreryEpochJd, setOrreryEpochJd } from "../src/utils/orreryClock";
import { edgeReturn } from "../src/utils/edgeHaze";
import { cruiseCap } from "../src/utils/speedCap";
import { FUEL_DRAIN_PER_SEC, FUEL_MAX } from "../src/utils/fuel";

const DT = 1 / 60;
const DRAG = 0.982;
type Sph = { x: number; y: number; z: number; r: number };

let saved = 0;
beforeAll(() => { saved = orreryEpochJd(); setOrreryEpochJd(ORRERY_TEST_JD); });
afterAll(() => setOrreryEpochJd(saved));

function spheres(): Sph[] {
  const list: Sph[] = BODY_REACH.map((b) => {
    const p = bodyPositionAt(bodyById(b.key), 0, { x: 0, y: 0, z: 0 });
    return { x: p.x, y: p.y, z: p.z, r: b.reach };
  });
  list.push({ x: 0, y: 0, z: 0, r: SUN_RADIUS });
  return list;
}
const reach = (id: string) => BODY_REACH.find((b) => b.key === id)!;
const centre = (id: string) => bodyPositionAt(bodyById(id as never), 0, { x: 0, y: 0, z: 0 });

describe("cruise limit", () => {
  it("scales with free space between 39 and 468", () => {
    expect(CRUISE_FREE_REF).toBe(60);
    expect(CRUISE_MAX_FACTOR).toBe(12);
    expect(cruiseLimit(0)).toBe(39);
    expect(cruiseLimit(60)).toBe(39);
    expect(cruiseLimit(300)).toBeCloseTo(195, 9);
    expect(cruiseLimit(1e5)).toBe(468);
  });
  it("rises by at most CRUISE_ACCEL*dt, falls at once", () => {
    expect(CRUISE_ACCEL).toBe(150);
    expect(stepCruise(39, 468, DT)).toBeCloseTo(41.5, 9);
    expect(stepCruise(400, 39, DT)).toBe(39);
    expect(stepCruise(466, 468, DT)).toBe(468);
  });
});

describe("raceWarpSpeed", () => {
  it("holds a racer to the base warp speed, whatever the free space", () => {
    for (const [cur, limit] of [[39, 468], [200, 468], [468, 468], [39, 39], [300, 100]]) {
      expect(raceWarpSpeed(cur, true, limit, DT)).toBe(SHIP_WARP_SPEED);
    }
    expect(SHIP_WARP_SPEED).toBe(39);
  });
  it("is stepCruise when not racing", () => {
    for (const [cur, limit] of [[39, 468], [200, 468], [466, 468], [400, 39], [39, 39]]) {
      expect(raceWarpSpeed(cur, false, limit, DT)).toBe(stepCruise(cur, limit, DT));
    }
  });
});

describe("shipWarpSpeed (C5: the Nest's fighting area holds warp like a race)", () => {
  it("in the fighting area, warp holds at 39 u/s however open the space", () => {
    for (const [cur, limit] of [[39, 468], [200, 468], [39, 39 * 12]]) {
      expect(shipWarpSpeed(cur, false, true, limit, DT)).toBe(SHIP_WARP_SPEED);
    }
  });
  it("racing holds it too; neither racing nor in the area, it builds with the free space", () => {
    expect(shipWarpSpeed(200, true, false, 468, DT)).toBe(SHIP_WARP_SPEED);
    for (const [cur, limit] of [[39, 468], [200, 468], [400, 39]]) {
      expect(shipWarpSpeed(cur, false, false, limit, DT)).toBe(stepCruise(cur, limit, DT));
    }
    expect(shipWarpSpeed(39, false, false, 468, DT)).toBeGreaterThan(SHIP_WARP_SPEED);
  });
});

describe("clampRaceVelocity", () => {
  const len = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x + b.x, a.y + b.y, a.z + b.z);

  it("racing: caps the total (pilot + gravity) speed at 39, keeping its direction", () => {
    const v = { x: 39, y: 0, z: 0 }, g = { x: 0, y: 12, z: 5 };
    const dir = { x: 39 / len(v, g), y: 12 / len(v, g), z: 5 / len(v, g) };
    clampRaceVelocity(v, g, true);
    expect(len(v, g)).toBeCloseTo(SHIP_WARP_SPEED, 9);
    expect((v.x + g.x) / SHIP_WARP_SPEED).toBeCloseTo(dir.x, 9);
    expect((v.y + g.y) / SHIP_WARP_SPEED).toBeCloseTo(dir.y, 9);
    expect((v.z + g.z) / SHIP_WARP_SPEED).toBeCloseTo(dir.z, 9);
  });

  it("racing: a total at or below 39 is left alone", () => {
    const v = { x: 30, y: 0, z: 0 }, g = { x: 0, y: 9, z: 0 };
    clampRaceVelocity(v, g, true);
    expect(v).toEqual({ x: 30, y: 0, z: 0 });
    expect(g).toEqual({ x: 0, y: 9, z: 0 });
  });

  it("not racing: nothing changes, however fast", () => {
    const v = { x: 468, y: 0, z: 0 }, g = { x: 0, y: 40, z: 0 };
    clampRaceVelocity(v, g, false);
    expect(v).toEqual({ x: 468, y: 0, z: 0 });
    expect(g).toEqual({ x: 0, y: 40, z: 0 });
  });
});

describe("freeDistance", () => {
  it("is the minimum of surface distances and the edge", () => {
    const s = [{ x: 100, y: 0, z: 0, r: 10 }, { x: 0, y: 500, z: 0, r: 5 }];
    expect(freeDistance({ x: 0, y: 0, z: 0 }, s, 2, 3600)).toBeCloseTo(90, 9);
    expect(freeDistance({ x: 0, y: 0, z: 0 }, s, 1, 3600)).toBeCloseTo(90, 9);
    expect(freeDistance({ x: 0, y: 0, z: 0 }, s, 0, 3600)).toBe(3600);
    expect(freeDistance({ x: 3590, y: 0, z: 0 }, s, 2, 3600)).toBeCloseTo(10, 9);
  });
  it("only reads the first `count` spheres", () => {
    const s = [{ x: 1000, y: 0, z: 0, r: 1 }, { x: 5, y: 0, z: 0, r: 1 }];
    expect(freeDistance({ x: 0, y: 0, z: 0 }, s, 1, 3600)).toBeCloseTo(999, 9);
  });
});

type Ship = { p: { x: number; y: number; z: number }; v: { x: number; y: number; z: number }; w: number };

/**
 * One frame of Spaceship.tsx's warp model, shared by every sim here so they
 * cannot drift: warpSpeed steps toward cruiseLimit(freeDistance), warping sets
 * velocity to nose * cruiseCap(warpSpeed), then drag, then integrate. Released
 * warp resets warpSpeed to the base and the ship just coasts through the drag.
 */
function frame(ship: Ship, sp: readonly Sph[], warping: boolean, nx: number, ny: number, nz: number): void {
  if (warping) {
    ship.w = stepCruise(ship.w, cruiseLimit(freeDistance(ship.p, sp, sp.length, SYSTEM_RADIUS)), DT);
    const c = cruiseCap(ship.w, DRAG, DT);
    ship.v.x = nx * c; ship.v.y = ny * c; ship.v.z = nz * c;
  } else ship.w = SHIP_WARP_SPEED;
  const k = Math.pow(DRAG, DT * 60);
  ship.v.x *= k; ship.v.y *= k; ship.v.z *= k;
  ship.p.x += ship.v.x * DT; ship.p.y += ship.v.y * DT; ship.p.z += ship.v.z * DT;
}
const speedOf = (s: Ship) => Math.hypot(s.v.x, s.v.y, s.v.z);

describe("cruise flight", () => {
  it("Earth to Neptune takes 10 to 20 s and less than a tank", () => {
    const sp = spheres();
    const e = centre("earth"), n = centre("neptune");
    const d0 = Math.hypot(n.x - e.x, n.y - e.y, n.z - e.z);
    const ux = (n.x - e.x) / d0, uy = (n.y - e.y) / d0, uz = (n.z - e.z) / d0;
    const start = reach("earth").reach + 20;
    const ship: Ship = {
      p: { x: e.x + ux * start, y: e.y + uy * start, z: e.z + uz * start },
      v: { x: 0, y: 0, z: 0 }, w: SHIP_WARP_SPEED,
    };
    let t = 0;
    for (;;) {
      const dx = n.x - ship.p.x, dy = n.y - ship.p.y, dz = n.z - ship.p.z, d = Math.hypot(dx, dy, dz);
      if (d <= 100 || t >= 120) break;
      frame(ship, sp, true, dx / d, dy / d, dz / d);
      t += DT;
    }
    // ~18.6 s at the time of writing: ~3000 u at up to 468 u/s, plus the 3 s build
    // and the slow-down in the free space near each end. Under 10 s would mean cruise is too fast.
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThanOrEqual(20);
    expect(FUEL_DRAIN_PER_SEC * t).toBeLessThan(FUEL_MAX);
  });

  describe("head-on at Jupiter, from 1500 u out (full per-frame model, never stopped by the test)", () => {
    const j = centre("jupiter"), size = reach("jupiter").size, jr = reach("jupiter").reach;
    const fresh = (): Ship => ({ p: { x: j.x + 1500, y: j.y, z: j.z }, v: { x: 0, y: 0, z: 0 }, w: SHIP_WARP_SPEED });
    const surface = (s: Ship) => Math.hypot(s.p.x - j.x, s.p.y - j.y, s.p.z - j.z) - jr;

    it("holding warp all the way in arrives at base warp speed or slower", () => {
      const sp = spheres(), ship = fresh();
      let inside60 = 0, peak = 0;
      for (let i = 0; i < 60 * 120 && surface(ship) > 0; i++) {
        frame(ship, sp, true, -1, 0, 0);
        peak = Math.max(peak, ship.w);
        if (surface(ship) <= 60) inside60 = Math.max(inside60, speedOf(ship), ship.w);
      }
      expect(peak).toBeGreaterThan(200); // it really did cruise
      expect(surface(ship)).toBeLessThanOrEqual(0); // and reached the body (collision takes over there)
      expect(inside60).toBeLessThanOrEqual(SHIP_WARP_SPEED + 1e-9);
    });

    it.each([1400, 900, 600, 300, 100, 61])("releasing warp %i u from the surface stops short of it", (release) => {
      const sp = spheres(), ship = fresh();
      let closest = Infinity, atRelease = 0, warping = true;
      for (let i = 0; i < 60 * 120; i++) {
        if (warping && surface(ship) <= release) { warping = false; atRelease = speedOf(ship); }
        frame(ship, sp, warping, -1, 0, 0);
        closest = Math.min(closest, surface(ship) + jr);
        if (!warping && speedOf(ship) < 1e-3) break;
      }
      if (release >= 600) expect(atRelease).toBeGreaterThan(39); // the cases that matter: released at speed
      expect(closest).toBeGreaterThanOrEqual(size + 1);
    });
  });

  it("a straight run outward at full cruise peaks below SYSTEM_RADIUS + 100", () => {
    const sp: Sph[] = []; // open space, nothing but the edge
    const p = { x: 1000, y: 0, z: 0 }, v = { x: 0, y: 0, z: 0 };
    let w = SHIP_WARP_SPEED, peak = 0, cut = false;
    for (let i = 0; i < 60 * 60; i++) {
      const r = Math.hypot(p.x, p.y, p.z);
      if (r > SYSTEM_RADIUS) cut = true; // edgeLatch: warp refused once past the edge
      w = stepCruise(w, cruiseLimit(freeDistance(p, sp, 0, SYSTEM_RADIUS)), DT);
      if (!cut) { const s = cruiseCap(w, DRAG, DT); v.x = s; v.y = 0; v.z = 0; }
      v.x *= Math.pow(DRAG, DT * 60);
      edgeReturn(p, v, DT);
      p.x += v.x * DT; p.y += v.y * DT; p.z += v.z * DT;
      peak = Math.max(peak, Math.hypot(p.x, p.y, p.z));
    }
    expect(peak).toBeLessThan(SYSTEM_RADIUS + 100);
  });
});
