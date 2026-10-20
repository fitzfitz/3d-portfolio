import { describe, it, expect } from "vitest";
import {
  inCone, consider, createSelection, clearSelection, pullStep, reelStep, reserveFirst,
  BEAM_RANGE, BEAM_MAX_TARGETS, REEL_ACCEL, nearestShardInCone,
} from "../src/utils/tractorBeam";

describe("inCone", () => {
  it("accepts a target ahead within range and rejects one behind or off-axis", () => {
    expect(inCone(0, 0, 0, 0, 0, 1, 0, 0, 20, BEAM_RANGE)).toBeCloseTo(20);
    expect(inCone(0, 0, 0, 0, 0, 1, 0, 0, -20, BEAM_RANGE)).toBe(-1);
    expect(inCone(0, 0, 0, 0, 0, 1, 20, 0, 20, BEAM_RANGE)).toBe(-1); // 45° off
    expect(inCone(0, 0, 0, 0, 0, 1, 0, 0, 31, BEAM_RANGE)).toBe(-1);
  });
  it("does not see a target across the old seam", () => {
    // Ship at x=245 looking +x; a crystal at x=-248 is 493u away, out of range.
    expect(inCone(245, 0, 0, 1, 0, 0, -248, 0, 0, BEAM_RANGE)).toBe(-1);
  });
});

describe("consider", () => {
  it("keeps the nearest BEAM_MAX_TARGETS, nearest first", () => {
    const sel = createSelection();
    for (const [i, d] of [[0, 25], [1, 5], [2, 18], [3, 9], [4, 30]] as const) consider(sel, BEAM_MAX_TARGETS, "crystal", i, -1, d, 0, 0, d);
    expect(sel.count).toBe(3);
    expect(sel.index.slice(0, 3)).toEqual([1, 3, 2]);
    clearSelection(sel);
    expect(sel.count).toBe(0);
  });
  it("takes a probe like any target: nearest first, inside the shared budget", () => {
    const sel = createSelection();
    // TractorBeam considers the probe first, then crystals.
    consider(sel, BEAM_MAX_TARGETS, "probe", 2, -1, 12, 0, 0, 12);
    consider(sel, BEAM_MAX_TARGETS, "crystal", 0, -1, 20, 0, 0, 20);
    consider(sel, BEAM_MAX_TARGETS, "crystal", 1, -1, 6, 0, 0, 6);
    consider(sel, BEAM_MAX_TARGETS, "crystal", 3, -1, 25, 0, 0, 25);
    expect(sel.count).toBe(3);
    expect(sel.kind.slice(0, 3)).toEqual(["crystal", "probe", "crystal"]);
    expect(sel.index.slice(0, 3)).toEqual([1, 2, 0]);
    // Two tethered pebbles leave one slot: the nearer probe keeps it.
    clearSelection(sel);
    consider(sel, 1, "probe", 0, -1, 10, 0, 0, 10);
    consider(sel, 1, "crystal", 4, -1, 15, 0, 0, 15);
    expect(sel.count).toBe(1);
    expect(sel.kind[0]).toBe("probe");
    expect(sel.index[0]).toBe(0);
    // A tie keeps the target considered first: the probe.
    clearSelection(sel);
    consider(sel, 1, "probe", 1, -1, 10, 0, 0, 10);
    consider(sel, 1, "crystal", 5, -1, 10, 0, 0, 10);
    expect(sel.kind[0]).toBe("probe");
  });
  it("reserveFirst gives a probe sel[0] even when three crystals are nearer", () => {
    const sel = createSelection();
    // TractorBeam: crystals share budget - 1, then the probe takes the reserved slot.
    for (const [i, d] of [[0, 3], [1, 5], [2, 4]] as const) consider(sel, BEAM_MAX_TARGETS - 1, "crystal", i, -1, d, 0, 0, d);
    reserveFirst(sel, BEAM_MAX_TARGETS, "probe", 1, -1, 20, 0, 0, 20);
    expect(sel.count).toBe(3);
    expect(sel.kind.slice(0, 3)).toEqual(["probe", "crystal", "crystal"]);
    expect(sel.index.slice(0, 3)).toEqual([1, 0, 2]);
    expect(sel.dist.slice(0, 3)).toEqual([20, 3, 4]);
  });
  it("reserveFirst into an empty selection, and never past the cap", () => {
    const sel = createSelection();
    reserveFirst(sel, 1, "probe", 0, -1, 9, 0, 0, 9);
    expect(sel.count).toBe(1);
    expect(sel.kind[0]).toBe("probe");
    reserveFirst(sel, 0, "probe", 2, -1, 9, 0, 0, 9); // no budget: no slot
    expect(sel.count).toBe(1);
    expect(sel.index[0]).toBe(0);
  });
  it("respects a smaller budget", () => {
    const sel = createSelection();
    consider(sel, 1, "shard", 7, -1, 12, 0, 0, 12);
    consider(sel, 1, "shard", 8, -1, 4, 0, 0, 4);
    expect(sel.count).toBe(1);
    expect(sel.index[0]).toBe(8);
  });
});

describe("pullStep", () => {
  it("closes the gap at the pull speed relative to a moving ship", () => {
    const p = { x: 0, y: 0, z: 20 }, ship = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 10 };
    // The ship moves +z at 10; the item first rides along (+1), then closes 2u toward it.
    const left = pullStep(p, ship, vel, 20, 0.1);
    expect(p.z).toBeCloseTo(19);
    expect(left).toBeCloseTo(19);
  });
  it("never overshoots the ship", () => {
    const p = { x: 0, y: 0, z: 1 };
    pullStep(p, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 20, 1);
    expect(p.z).toBeCloseTo(0);
  });
});

describe("reelStep", () => {
  it("accelerates toward the shard and never past cruise speed", () => {
    const v = { x: 0, y: 0, z: 0 };
    reelStep(v, 0, 0, 1, 0.1, 10.8);
    expect(v.z).toBeCloseTo(REEL_ACCEL * 0.1);
    for (let i = 0; i < 100; i++) reelStep(v, 0, 0, 1, 0.1, 10.8);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(10.8);
  });
});

describe("reeling to a shard", () => {
  it("brings a parked ship within pickup range of a shard 25u ahead", () => {
    // Spaceship's loop: reel (counts as thrust), drag, integrate.
    const v = { x: 0, y: 0, z: 0 }, p = { x: 0, y: 0, z: 0 }, shard = { x: 0, y: 0, z: 25 };
    let t = 0;
    while (Math.hypot(shard.x - p.x, shard.y - p.y, shard.z - p.z) >= 3 && t < 10) {
      const dt = 1 / 60;
      const dx = shard.x - p.x, dy = shard.y - p.y, dz = shard.z - p.z, d = Math.hypot(dx, dy, dz);
      reelStep(v, dx / d, dy / d, dz / d, dt, 10.8);
      const k = Math.pow(0.982, dt * 60); v.x *= k; v.y *= k; v.z *= k;
      p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      t += dt;
    }
    expect(t).toBeLessThan(5);
  });
});

describe("nearestShardInCone", () => {
  const shards = [{ pos: [0, 0, 40] as [number, number, number] }, { pos: [0, 0, 22] as [number, number, number] }, { pos: [30, 0, 5] as [number, number, number] }];
  it("picks the nearest uncollected shard inside the cone", () => {
    expect(nearestShardInCone(0, 0, 0, 0, 0, 1, shards, [])).toBe(1);
    expect(nearestShardInCone(0, 0, 0, 0, 0, 1, shards, [1])).toBe(-1); // shard 0 is out of range (40u)
  });
});
