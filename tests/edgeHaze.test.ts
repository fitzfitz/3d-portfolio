import { describe, it, expect } from "vitest";
import { edgeDepth, edgeReturn, HazeLineGate, ReturnBurnLineGate, HAZE_START, EDGE_RETURN_SPEED, EdgeRadioClock } from "../src/utils/edgeHaze";
import { SYSTEM_RADIUS } from "../src/constants";

// p, v along +X for clarity; also run one case along (1,1,1)/sqrt3.
function fly(p0: number, v0: number, pilotOut: number, seconds: number, dir = [1, 0, 0]) {
  const L = Math.hypot(dir[0], dir[1], dir[2]), n = dir.map((c) => c / L);
  const p = { x: p0 * n[0], y: p0 * n[1], z: p0 * n[2] }, v = { x: v0 * n[0], y: v0 * n[1], z: v0 * n[2] };
  let maxR = p0, backInsideAt = -1, maxInward = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    v.x += (pilotOut * n[0]) / 60; v.y += (pilotOut * n[1]) / 60; v.z += (pilotOut * n[2]) / 60;
    edgeReturn(p, v, 1 / 60);
    p.x += v.x / 60; p.y += v.y / 60; p.z += v.z / 60;
    const r = Math.hypot(p.x, p.y, p.z);
    maxR = Math.max(maxR, r); maxInward = Math.max(maxInward, -(v.x * n[0] + v.y * n[1] + v.z * n[2]));
    if (backInsideAt < 0 && r < SYSTEM_RADIUS) backInsideAt = t;
  }
  return { maxR, backInsideAt, maxInward };
}

describe("return burn", () => {
  it("stops a warp-speed crossing before 440 and returns it within 6 s", () => {
    const r = fly(400.01, 39, 0, 10);
    expect(r.maxR).toBeLessThan(440); expect(r.backInsideAt).toBeGreaterThan(0); expect(r.backInsideAt).toBeLessThan(6);
  });
  it("still returns a pilot holding full outward thrust (25.2 u/s2)", () => {
    const r = fly(400.01, 10.8, 25.2, 15);
    expect(r.maxR).toBeLessThan(440); expect(r.backInsideAt).toBeGreaterThan(0);
  });
  it("never pushes inward faster than EDGE_RETURN_SPEED", () => {
    expect(fly(420, 0, 0, 10).maxInward).toBeLessThanOrEqual(EDGE_RETURN_SPEED + 1e-9);
  });
  it("does nothing inside the system", () => {
    const v = { x: 39, y: 0, z: 0 };
    expect(edgeReturn({ x: 399, y: 0, z: 0 }, v, 1 / 60)).toBe(false); expect(v.x).toBe(39);
  });
  it("bounds hold along (1,1,1)/sqrt3 as well", () => {
    const a = fly(400.01, 39, 0, 10, [1, 1, 1]);
    expect(a.maxR).toBeLessThan(440); expect(a.backInsideAt).toBeGreaterThan(0); expect(a.backInsideAt).toBeLessThan(6);
    const b = fly(400.01, 10.8, 25.2, 15, [1, 1, 1]);
    expect(b.maxR).toBeLessThan(440); expect(b.backInsideAt).toBeGreaterThan(0);
  });
  it("the burn line preempts the haze line but waits for any other broadcast", () => {
    const W = 6;
    const hazeFirst = new EdgeRadioClock();
    hazeFirst.observe(1, 0, () => true);
    expect(hazeFirst.busy(1, W)).toBe(true);
    expect(hazeFirst.busyIgnoringEdge(1, W)).toBe(false);
    const burn = new ReturnBurnLineGate();
    expect(burn.update(true, 1, hazeFirst.busyIgnoringEdge(1, W))).toBe(true);
    const other = new EdgeRadioClock();
    other.observe(1, 0, () => false);
    expect(other.busyIgnoringEdge(1, W)).toBe(true);
    expect(new ReturnBurnLineGate().update(true, 1, other.busyIgnoringEdge(1, W))).toBe(false);
  });
  it("works along a diagonal too", () => {
    const k = 400.5 / Math.sqrt(3), p = { x: k, y: k, z: k }, v = { x: 20, y: 20, z: 20 };
    expect(edgeReturn(p, v, 1 / 60)).toBe(true);
    expect(v.x).toBeCloseTo(v.y, 9); expect(v.x).toBeLessThan(20);
  });
  it("the return-burn line plays once, then waits out its 20 s cooldown", () => {
    const g = new ReturnBurnLineGate();
    expect(g.update(true, 0, false)).toBe(true); expect(g.update(true, 5, false)).toBe(false);
    expect(g.update(true, 21, true)).toBe(false); expect(g.update(true, 22, false)).toBe(true);
    expect(g.update(false, 50, false)).toBe(false);
  });
});

describe("edgeDepth", () => {
  it("is radial: 0 inside 360, 1 at 400 and beyond, along any direction", () => {
    const d = (r: number) => edgeDepth(r / Math.sqrt(3), r / Math.sqrt(3), r / Math.sqrt(3));
    expect(d(359)).toBe(0); expect(d(400)).toBeCloseTo(1, 9); expect(d(430)).toBe(1);
    expect(edgeDepth(250, 250, 0)).toBe(0);
    expect(edgeDepth(HAZE_START, 0, 0)).toBe(0);
  });
});

describe("HazeLineGate", () => {
  it("fires once per visit, when depth first passes 0.3", () => {
    const g = new HazeLineGate();
    expect(g.update(0.2, false, false)).toBe(false);
    expect(g.update(0.35, false, false)).toBe(true);
    expect(g.update(0.8, false, false)).toBe(false);
    expect(g.update(0.05, false, false)).toBe(false); // re-arms
    expect(g.update(0.4, false, false)).toBe(true);
  });
  it("holds the line while the radio is busy or a race runs, then fires", () => {
    const g = new HazeLineGate();
    expect(g.update(0.5, true, false)).toBe(false);
    expect(g.update(0.5, false, true)).toBe(false);
    expect(g.update(0.5, false, false)).toBe(true);
  });
});
