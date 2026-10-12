import { describe, it, expect } from "vitest";
import {
  flareEnvelope, flareLevel, planCometPass, cometPassAt, convoyOffsetAt, convoyShipOffsetAt, planConvoy,
  COMET_PASS_DIST, COMET_ENTRY_DIST, COMET_SPEED,
  CONVOY_ORBIT_FACTOR, CONVOY_APPROACH_S, CONVOY_ORBIT_S, CONVOY_HIDE_DIST, CONVOY_SPACING,
  type CometPass, type ConvoyPlan,
} from "../src/utils/worldEvents";
import { LOCK_RETAIN_FACTOR } from "../src/constants";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const len = (o: { x: number; y: number; z: number }) => Math.hypot(o.x, o.y, o.z);
const sub = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

/** Closest distance from `target` to the comet's line over its whole pass. */
function closestToTarget(p: CometPass, target: { x: number; y: number; z: number }) {
  let best = Infinity;
  const total = (2 * COMET_ENTRY_DIST) / COMET_SPEED;
  for (let t = 0; t <= total; t += 0.01) best = Math.min(best, len(sub(cometPassAt(v(), p, t), target)));
  return best;
}

describe("flareEnvelope", () => {
  it("starts and ends at zero", () => {
    expect(flareEnvelope(0)).toBe(0);
    expect(flareEnvelope(12)).toBe(0);
    expect(flareEnvelope(-1)).toBe(0);
    expect(flareEnvelope(20)).toBe(0);
  });
  it("swells to exactly 1, twice, at least 3s apart, and never above 1", () => {
    const peaks: number[] = [];
    let prev = 0, rising = true;
    for (let t = 0; t <= 12; t += 0.01) {
      const f = flareEnvelope(t);
      expect(f).toBeLessThanOrEqual(1 + 1e-9);
      if (rising && f < prev) peaks.push(t - 0.01);
      rising = f >= prev;
      prev = f;
    }
    expect(peaks.length).toBe(2);
    expect(peaks[1] - peaks[0]).toBeGreaterThanOrEqual(3);
    expect(flareEnvelope(3)).toBeCloseTo(1, 6);
  });
  it("flareLevel is 0 with no flare running and follows the envelope otherwise", () => {
    expect(flareLevel(null)).toBe(0);
    expect(flareLevel(3)).toBeCloseTo(1, 6);
    expect(flareLevel(6)).toBeCloseTo(0, 6);
  });
});

describe("comet pass", () => {
  it("passes the target at the planned distance", () => {
    const target = v(10, 20, 30);
    const p = planCometPass(target, [], lcg(3))!;
    expect(closestToTarget(p, target)).toBeCloseTo(COMET_PASS_DIST, 1);
  });
  it("enters far away and flies at the planned speed", () => {
    const p = planCometPass(v(), [], lcg(5))!;
    expect(len(sub(cometPassAt(v(), p, 0), v()))).toBeCloseTo(Math.hypot(COMET_ENTRY_DIST, COMET_PASS_DIST), 3);
    expect(len(sub(cometPassAt(v(), p, 1), cometPassAt(v(), p, 0)))).toBeCloseTo(COMET_SPEED, 6);
  });
  it("never flies through an obstacle sphere", () => {
    const avoid = [{ x: 60, y: 0, z: 0, r: 40 }, { x: -60, y: 0, z: 0, r: 40 }];
    for (let seed = 1; seed < 30; seed++) {
      const p = planCometPass(v(), avoid, lcg(seed));
      if (!p) continue;
      const total = (2 * COMET_ENTRY_DIST) / COMET_SPEED;
      for (let t = 0; t <= total; t += 0.05) {
        const q = cometPassAt(v(), p, t);
        for (const a of avoid) expect(len(sub(q, a))).toBeGreaterThan(a.r);
      }
    }
  });
  it("gives up when no clear line exists", () => {
    expect(planCometPass(v(), [{ x: 0, y: 0, z: 0, r: 1000 }], lcg(9))).toBeNull();
  });
  it("is deterministic for a given random source", () => {
    expect(planCometPass(v(1, 2, 3), [], lcg(11))).toEqual(planCometPass(v(1, 2, 3), [], lcg(11)));
  });
});

describe("convoy path", () => {
  const size = 16;
  const plan = planConvoy(v(130, 0, 0), size, () => true)!;
  const R = CONVOY_ORBIT_FACTOR * size;

  it("orbits at 2.2x size, outside the lock-retain radius", () => {
    expect(plan.R).toBeCloseTo(R);
    expect(plan.R).toBeGreaterThan(size * LOCK_RETAIN_FACTOR);
    for (let t = CONVOY_APPROACH_S; t <= CONVOY_APPROACH_S + CONVOY_ORBIT_S; t += 0.5) {
      expect(len(convoyOffsetAt(v(), plan, t))).toBeCloseTo(R, 6);
    }
  });
  it("approaches from the side away from the sun", () => {
    expect(convoyOffsetAt(v(), plan, 0).x).toBeGreaterThan(150); // planet at +x: start further out on +x
  });
  it("is continuous at both seams", () => {
    for (const seam of [CONVOY_APPROACH_S, CONVOY_APPROACH_S + CONVOY_ORBIT_S]) {
      const a = convoyOffsetAt(v(), plan, seam - 1e-4);
      const b = convoyOffsetAt(v(), plan, seam + 1e-4);
      expect(len(sub(a, b))).toBeLessThan(0.01);
    }
  });
  it("leaves past the hide distance by the end", () => {
    expect(len(convoyOffsetAt(v(), plan, 40))).toBeGreaterThan(CONVOY_HIDE_DIST);
  });
  it("never cuts through the target planet", () => {
    for (let t = 0; t <= 40; t += 0.1) expect(len(convoyOffsetAt(v(), plan, t))).toBeGreaterThan(size + 3);
  });
  it("keeps the wingmen in a V at constant spacing", () => {
    for (let t = 1; t <= 38; t += 1.5) {
      const lead = convoyShipOffsetAt(v(), plan, t, 0);
      for (const slot of [1, 2] as const) {
        expect(len(sub(convoyShipOffsetAt(v(), plan, t, slot), lead))).toBeCloseTo(Math.SQRT2 * CONVOY_SPACING, 3);
      }
      expect(len(sub(convoyShipOffsetAt(v(), plan, t, 1), convoyShipOffsetAt(v(), plan, t, 2)))).toBeCloseTo(2 * CONVOY_SPACING, 3);
    }
  });
  it("tries other approach angles, and gives up when none is clear", () => {
    let calls = 0;
    expect(planConvoy(v(130, 0, 0), size, () => ++calls === 2)).not.toBeNull();
    expect(calls).toBe(2);
    expect(planConvoy(v(130, 0, 0), size, () => false)).toBeNull();
  });
  it("produces orthonormal frame vectors", () => {
    const p: ConvoyPlan = plan;
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const u = [p.ux, p.uy, p.uz], vv = [p.vx, p.vy, p.vz], w = [p.wx, p.wy, p.wz];
    expect(dot(u, u)).toBeCloseTo(1); expect(dot(vv, vv)).toBeCloseTo(1); expect(dot(w, w)).toBeCloseTo(1);
    expect(dot(u, vv)).toBeCloseTo(0); expect(dot(u, w)).toBeCloseTo(0); expect(dot(vv, w)).toBeCloseTo(0);
  });
});
