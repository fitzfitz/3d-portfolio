import { describe, it, expect } from "vitest";
import { edgeDepth, edgeReturn, HazeLineGate, ReturnBurnLineGate, HAZE_START, EDGE_RETURN_SPEED, EdgeRadioClock, edgeLatch } from "../src/utils/edgeHaze";
import { SYSTEM_RADIUS, VALIDATION_RADIUS } from "../src/constants";

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

/** Past the edge the burn may let the ship out at most this far (the Worker accepts VALIDATION_RADIUS). */
const OVERSHOOT_BOUND = SYSTEM_RADIUS + 20;
const EDGE = SYSTEM_RADIUS + 0.01;

describe("return burn", () => {
  it("the overshoot bound sits inside the Worker's acceptance radius", () => {
    expect(OVERSHOOT_BOUND).toBeLessThanOrEqual(VALIDATION_RADIUS);
  });
  it("stops a warp-speed crossing within 20 of the edge and returns it within 6 s", () => {
    const r = fly(EDGE, 39, 0, 10);
    expect(r.maxR).toBeLessThan(OVERSHOOT_BOUND); expect(r.backInsideAt).toBeGreaterThan(0); expect(r.backInsideAt).toBeLessThan(6);
  });
  it("still returns a pilot holding full outward thrust (25.2 u/s2)", () => {
    const r = fly(EDGE, 10.8, 25.2, 15);
    expect(r.maxR).toBeLessThan(OVERSHOOT_BOUND); expect(r.backInsideAt).toBeGreaterThan(0);
  });
  it("never pushes inward faster than EDGE_RETURN_SPEED", () => {
    expect(fly(SYSTEM_RADIUS + 20, 0, 0, 10).maxInward).toBeLessThanOrEqual(EDGE_RETURN_SPEED + 1e-9);
  });
  it("does nothing inside the system", () => {
    const v = { x: 39, y: 0, z: 0 };
    expect(edgeReturn({ x: SYSTEM_RADIUS - 1, y: 0, z: 0 }, v, 1 / 60)).toBe(false); expect(v.x).toBe(39);
  });
  it("bounds hold along (1,1,1)/sqrt3 as well", () => {
    const a = fly(EDGE, 39, 0, 10, [1, 1, 1]);
    expect(a.maxR).toBeLessThan(OVERSHOOT_BOUND); expect(a.backInsideAt).toBeGreaterThan(0); expect(a.backInsideAt).toBeLessThan(6);
    const b = fly(EDGE, 10.8, 25.2, 15, [1, 1, 1]);
    expect(b.maxR).toBeLessThan(OVERSHOOT_BOUND); expect(b.backInsideAt).toBeGreaterThan(0);
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
    const k = (SYSTEM_RADIUS + 0.5) / Math.sqrt(3), p = { x: k, y: k, z: k }, v = { x: 20, y: 20, z: 20 };
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
  it("the haze starts 40 inside the edge, derived from SYSTEM_RADIUS", () => {
    expect(HAZE_START).toBe(SYSTEM_RADIUS - 40);
  });
  it("is radial: 0 inside HAZE_START, 1 at SYSTEM_RADIUS and beyond, along any direction", () => {
    const d = (r: number) => edgeDepth(r / Math.sqrt(3), r / Math.sqrt(3), r / Math.sqrt(3));
    expect(d(HAZE_START - 1)).toBe(0); expect(d(SYSTEM_RADIUS)).toBeCloseTo(1, 9); expect(d(SYSTEM_RADIUS + 30)).toBe(1);
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

describe("edge latch (no warp re-engage at the edge)", () => {
  it("sets past SYSTEM_RADIUS, holds while boosting through the burn's return, clears on release or deep inside", () => {
    expect(edgeLatch(false, SYSTEM_RADIUS + 0.1, true)).toBe(true);
    expect(edgeLatch(true, SYSTEM_RADIUS - 5, true)).toBe(true); // burn brought it back to the edge: still latched
    expect(edgeLatch(true, SYSTEM_RADIUS - 5, false)).toBe(false); // boost released
    expect(edgeLatch(true, HAZE_START - 1, true)).toBe(false); // well inside the haze start
    expect(edgeLatch(false, SYSTEM_RADIUS - 5, true)).toBe(false); // never crossed
  });
  it("a held-Shift outward run never re-warps after the cut", () => {
    let latched = false, warpedAfterCut = false, cut = false;
    const p = SYSTEM_RADIUS - 1, dt = 1 / 60;
    const pos = { x: p, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 0 };
    for (let t = 0; t < 20; t += dt) {
      const r = Math.hypot(pos.x, pos.y, pos.z);
      latched = edgeLatch(latched, r, true);
      const warp = !latched;
      if (latched) cut = true;
      if (cut && warp) warpedAfterCut = true;
      if (warp) { vel.x = 130; } // outward warp along +x
      edgeReturn(pos, vel, dt);
      pos.x += vel.x * dt;
    }
    expect(cut).toBe(true);
    expect(warpedAfterCut).toBe(false);
  });
});
