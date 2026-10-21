import { describe, it, expect } from "vitest";
import {
  flareEnvelope, flareLevel, planCometPass, cometPassAt, convoyOffsetAt, convoyShipOffsetAt, planConvoy, planNearestConvoy,
  COMET_PASS_DIST, COMET_ENTRY_DIST, COMET_SPEED,
  CONVOY_ORBIT_FACTOR, convoyRadius, CONVOY_APPROACH_S, CONVOY_ORBIT_S, CONVOY_HIDE_DIST, CONVOY_SPACING,
  type CometPass, type ConvoyPlan,
} from "../src/utils/worldEvents";
import { AU, LOCK_RETAIN_FACTOR, SUN_RADIUS } from "../src/constants";
import { SOLAR_BODIES, bodyById } from "../src/data/solarSystem";
import { eventLines } from "../src/data/chatterLines";

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
  it("checks the whole 25s flight, not just the first 500u", () => {
    // Review M2: segmentClear covered 2x the entry distance (500u) but the comet
    // flies 22u/s x 25s = 550u, so an obstacle on the last 50u went unseen.
    const free = planCometPass(v(), [], lcg(21))!;
    const late = cometPassAt(v(), free, 24); // ~528u along the line
    const blocker = { ...late, r: 5 };
    const p = planCometPass(v(), [blocker], lcg(21));
    if (p) for (let t = 0; t <= 25; t += 0.05) expect(len(sub(cometPassAt(v(), p, t), blocker))).toBeGreaterThan(blocker.r);
  });
  it("gives up when no clear line exists", () => {
    expect(planCometPass(v(), [{ x: 0, y: 0, z: 0, r: 1000 }], lcg(9))).toBeNull();
  });
  it("is deterministic for a given random source", () => {
    expect(planCometPass(v(1, 2, 3), [], lcg(11))).toEqual(planCometPass(v(1, 2, 3), [], lcg(11)));
  });
});

describe("convoy path", () => {
  for (const body of SOLAR_BODIES) {
    const size = body.size;
    const plan = planConvoy(v(130, 0, 0), size, () => true)!;
    const R = convoyRadius(size);

    it(`${body.id} (size ${size}): every convoy slot stays outside lock-retain, with a 2u margin, for the whole event`, () => {
      const floor = size * LOCK_RETAIN_FACTOR + 2;
      for (const slot of [0, 1, 2] as const) {
        let min = Infinity;
        for (let t = 0; t <= CONVOY_APPROACH_S + CONVOY_ORBIT_S + 5; t += 0.01) {
          min = Math.min(min, len(convoyShipOffsetAt(v(), plan, t, slot)));
        }
        expect(min, `slot ${slot}`).toBeGreaterThan(floor);
      }
    });
    it(`${body.id} (size ${size}): orbits at convoyRadius, at least CONVOY_ORBIT_FACTOR x size and outside lock-retain`, () => {
      expect(plan.R).toBeCloseTo(R);
      expect(plan.R).toBeGreaterThanOrEqual(CONVOY_ORBIT_FACTOR * size);
      expect(plan.R).toBeGreaterThan(size * LOCK_RETAIN_FACTOR);
      for (let t = CONVOY_APPROACH_S; t <= CONVOY_APPROACH_S + CONVOY_ORBIT_S; t += 0.5) {
        expect(len(convoyOffsetAt(v(), plan, t))).toBeCloseTo(R, 6);
      }
    });
  }
  const size = 16;
  const plan = planConvoy(v(130, 0, 0), size, () => true)!;
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
  it("keeps speed continuous at both seams (no lurch into or out of orbit)", () => {
    // Review I2: the Bezier ended at 0.3R u/s but the orbit ran at R*omega (~0.52R),
    // a ~75% jump at orbit insertion.
    // Sample tightly around each seam: the departure accelerates (24u/s^2), so a
    // wide window would measure that ramp rather than a jump at the seam itself.
    const speed = (t: number) => len(sub(convoyOffsetAt(v(), plan, t + 1e-4), convoyOffsetAt(v(), plan, t - 1e-4))) / 2e-4;
    for (const seam of [CONVOY_APPROACH_S, CONVOY_APPROACH_S + CONVOY_ORBIT_S]) {
      const before = speed(seam - 1e-3), after = speed(seam + 1e-3);
      expect(Math.abs(after - before) / before, `seam ${seam}`).toBeLessThan(0.02);
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

describe("convoy target", () => {
  const at = (x: number, y = 0, z = 0) => v(x, y, z);
  it("takes the nearest body whose route is clear, not just the nearest", () => {
    const near = { id: "near", size: 2, pos: at(50) }, mid = { id: "mid", size: 2, pos: at(-80) }, far = { id: "far", size: 2, pos: at(300) };
    const tried: string[] = [];
    const got = planNearestConvoy([far, mid, near], (b) => b.pos, at(40), (b) => { tried.push(b.id); return b.id !== "near"; });
    expect(got?.body.id).toBe("mid");
    // The nearest tries all eight entry angles first, then the next nearest.
    expect(tried.slice(0, 8)).toEqual(Array(8).fill("near"));
    expect(tried[8]).toBe("mid");
  });
  it("is null only when no body has a clear route", () => {
    const a = { id: "a", size: 2, pos: at(50) }, b = { id: "b", size: 2, pos: at(90) };
    expect(planNearestConvoy([a, b], (x) => x.pos, at(0), () => false)).toBeNull();
  });
  it("near Mercury, whose delivery orbit crosses the Sun's keep-out, the convoy goes to Venus instead of nowhere", () => {
    // Mercury at perihelion-ish 0.39 AU, Venus 0.72 AU on the far side; the
    // ship parked just outside Mercury. Clear = every ship clears the Sun's
    // keep-out (SUN_RADIUS + 10, as WorldEventDirector checks) over the route.
    const mercury = { ...bodyById("mercury"), pos: at(0.39 * AU) };
    const venus = { ...bodyById("venus"), pos: at(0, 0, -0.72 * AU) };
    const sunClear = (b: { pos: { x: number; y: number; z: number } }, plan: ConvoyPlan) => {
      for (let t = 0; t <= 40; t += 0.5) {
        for (const slot of [0, 1, 2] as const) {
          const o = convoyShipOffsetAt(v(), plan, t, slot);
          if (Math.hypot(b.pos.x + o.x, b.pos.y + o.y, b.pos.z + o.z) < SUN_RADIUS + 10) return false;
        }
      }
      return true;
    };
    const ship = at(0.39 * AU + 12);
    // The old rule (nearest only) found no route at all here.
    expect(planConvoy(mercury.pos, mercury.size, (p) => sunClear(mercury, p))).toBeNull();
    const got = planNearestConvoy([mercury, venus], (b) => b.pos, ship, sunClear);
    expect(got?.body.id).toBe("venus");
  });
});

describe("convoy lines", () => {
  it("has generic lines for bodies without their own", () => {
    expect(eventLines.convoyAny.length).toBeGreaterThan(0);
  });
});
