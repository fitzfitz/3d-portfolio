import { describe, it, expect } from "vitest";
import { edgeDepth, edgeReturn, HazeLineGate, ReturnBurnLineGate, HAZE_START, EDGE_RETURN_SPEED } from "../src/utils/edgeHaze";
import { SYSTEM_RADIUS } from "../src/constants";

// p, v along +X for clarity; also run one case along (1,1,1)/sqrt3.
function fly(p0: number, v0: number, pilotOut: number, seconds: number) {
  const p = { x: p0, y: 0, z: 0 }, v = { x: v0, y: 0, z: 0 };
  let maxR = p0, backInsideAt = -1, maxInward = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    v.x += pilotOut / 60;
    edgeReturn(p, v, 1 / 60);
    p.x += v.x / 60;
    maxR = Math.max(maxR, p.x); maxInward = Math.max(maxInward, -v.x);
    if (backInsideAt < 0 && p.x < SYSTEM_RADIUS) backInsideAt = t;
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
