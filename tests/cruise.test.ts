import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CRUISE_ACCEL, CRUISE_FREE_REF, CRUISE_MAX_FACTOR, cruiseLimit, freeDistance, stepCruise,
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

describe("cruise flight", () => {
  it("Earth to Neptune takes at most 20 s and less than a tank", () => {
    const sp = spheres();
    const e = centre("earth"), n = centre("neptune");
    const d0 = Math.hypot(n.x - e.x, n.y - e.y, n.z - e.z);
    const ux = (n.x - e.x) / d0, uy = (n.y - e.y) / d0, uz = (n.z - e.z) / d0;
    const start = reach("earth").reach + 20;
    const p = { x: e.x + ux * start, y: e.y + uy * start, z: e.z + uz * start };
    let w = SHIP_WARP_SPEED, t = 0, peak = 0;
    while (Math.hypot(p.x - n.x, p.y - n.y, p.z - n.z) > 100 && t < 120) {
      w = stepCruise(w, cruiseLimit(freeDistance(p, sp, sp.length, SYSTEM_RADIUS)), DT);
      const dx = n.x - p.x, dy = n.y - p.y, dz = n.z - p.z, d = Math.hypot(dx, dy, dz);
      const v = cruiseCap(w, DRAG, DT) * Math.pow(DRAG, DT * 60);
      p.x += (dx / d) * v * DT; p.y += (dy / d) * v * DT; p.z += (dz / d) * v * DT;
      peak = Math.max(peak, w); t += DT;
    }
    console.log(`trip ${t.toFixed(2)} s, peak ${peak.toFixed(0)} u/s, fuel ${(FUEL_DRAIN_PER_SEC * t).toFixed(1)}`);
    expect(t).toBeLessThanOrEqual(20);
    expect(FUEL_DRAIN_PER_SEC * t).toBeLessThan(FUEL_MAX);
  });

  it("a head-on run at Jupiter never enters the body and is at warp speed inside 60 u", () => {
    const sp = spheres();
    const j = centre("jupiter"), size = reach("jupiter").size;
    const p = { x: j.x + 1500, y: j.y, z: j.z };
    let w = SHIP_WARP_SPEED, closest = Infinity, worst = 0, t = 0;
    for (;;) {
      const free = freeDistance(p, sp, sp.length, SYSTEM_RADIUS);
      w = stepCruise(w, cruiseLimit(free), DT);
      const d = Math.hypot(p.x - j.x, p.y - j.y, p.z - j.z);
      closest = Math.min(closest, d);
      if (d - reach("jupiter").reach <= 60) worst = Math.max(worst, w);
      if (d - size <= 2 || (t += DT) > 120) break;
      p.x += ((j.x - p.x) / d) * w * DT; p.y += ((j.y - p.y) / d) * w * DT; p.z += ((j.z - p.z) / d) * w * DT;
    }
    expect(closest).toBeGreaterThanOrEqual(size + 1);
    expect(worst).toBeLessThanOrEqual(SHIP_WARP_SPEED);
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
