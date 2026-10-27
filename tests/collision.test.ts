import { describe, it, expect } from "vitest";
import { resolveCollision, resolveCluster } from "../src/utils/collision";
import { NEST_ROCK_COLLIDERS, NEST_ROCK_CHECK_R } from "../src/data/nestRocks";
import { NEST_CENTRE } from "../src/data/nest";

describe("resolveCollision", () => {
  it("returns null when outside the radius", () => {
    expect(resolveCollision(10, 0, 0, -1, 0, 0, 0, 0, 0, 5)).toBeNull();
  });
  it("reflects and damps a head-on hit, pushing out of penetration", () => {
    const r = resolveCollision(4.5, 0, 0, -10, 0, 0, 0, 0, 0, 5);
    expect(r).not.toBeNull();
    expect(r!.vx).toBeCloseTo(4.5); // reflected (+x) and damped x0.45
    expect(r!.px).toBeCloseTo(5.05); // pushed to radius + 0.05
  });
  it("leaves tangential velocity direction intact (graze)", () => {
    const r = resolveCollision(4.9, 0, 0, 0, 0, 8, 0, 0, 0, 5);
    expect(r).not.toBeNull();
    expect(r!.vz).toBeCloseTo(8 * 0.45); // no normal component to flip
    expect(r!.vx).toBeCloseTo(0);
  });
  it("handles the dead-center degenerate case without NaN", () => {
    const r = resolveCollision(0, 0, 0, 1, 0, 0, 0, 0, 0, 5);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.px)).toBe(true);
  });
});

describe("resolveCluster (overlapping spheres: the Nest's rocks)", () => {
  type S = { x: number; y: number; z: number; r: number };
  const SKIN = 0.05;
  const inside = (p: { x: number; y: number; z: number }, list: readonly S[]) =>
    list.some((c) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) < c.r);

  it("pushes a point in the crease of two overlapping spheres out of both in one call, reflecting only what heads in", () => {
    const pair: S[] = [{ x: -3, y: 0, z: 0, r: 4 }, { x: 3, y: 0, z: 0, r: 4 }];
    const p = { x: 0, y: 2, z: 0 }, v = { x: 0, y: -10, z: 0 };
    expect(resolveCluster(p, v, pair)).toBe(true);
    for (const c of pair) expect(Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z)).toBeGreaterThanOrEqual(c.r + SKIN - 1e-9);
    expect(v.y).toBeGreaterThan(0); // bounced out
    expect(v.y).toBeCloseTo(10 * 0.45);
    // Outside: untouched.
    const q = { x: 0, y: 9, z: 0 }, w = { x: 0, y: -1, z: 0 };
    expect(resolveCluster(q, w, pair)).toBe(false);
    expect([q.y, w.y]).toEqual([9, -1]);
  });

  it("matches resolveCollision's push-out for a single sphere", () => {
    const p = { x: 4.5, y: 0, z: 0 }, v = { x: -10, y: 0, z: 0 };
    resolveCluster(p, v, [{ x: 0, y: 0, z: 0, r: 5 }]);
    expect(p.x).toBeCloseTo(5.05);
    expect(v.x).toBeCloseTo(4.5);
  });

  it("is never NaN at a sphere's centre or midway between two equal spheres", () => {
    const p = { x: 0, y: 0, z: 0 }, v = { x: 0, y: 0, z: 0 };
    resolveCluster(p, v, [{ x: -1, y: 0, z: 0, r: 4 }, { x: 1, y: 0, z: 0, r: 4 }]);
    expect([p.x, p.y, p.z, v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
    expect(inside(p, [{ x: -1, y: 0, z: 0, r: 4 }, { x: 1, y: 0, z: 0, r: 4 }])).toBe(false);
  });

  it("a ship coasting into the Nest's shell, at any rock or between two that overlap, from outside or inside, settles clear of every rock within 3 steps, with one impact", () => {
    const rocks = NEST_ROCK_COLLIDERS;
    const C = { x: NEST_CENTRE[0], y: NEST_CENTRE[1], z: NEST_CENTRE[2] };
    const targets: { name: string; m: { x: number; y: number; z: number } }[] = rocks.map((a, i) => ({ name: `rock ${i}`, m: a }));
    for (let i = 0; i < rocks.length; i++) for (let j = i + 1; j < rocks.length; j++) {
      const a = rocks[i], b = rocks[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d >= a.r + b.r) continue;
      // The crease: on the line between the centres, at the two spheres' intersection plane.
      const t = (d * d + a.r * a.r - b.r * b.r) / (2 * d * d);
      targets.push({ name: `crease ${i}/${j}`, m: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t } });
    }
    expect(targets.length - rocks.length, "overlapping pairs").toBeGreaterThanOrEqual(1);
    for (const { name, m } of targets) {
      const ol = Math.hypot(m.x - C.x, m.y - C.y, m.z - C.z);
      const o = { x: (m.x - C.x) / ol, y: (m.y - C.y) / ol, z: (m.z - C.z) / ol };
      for (const from of ["outside", "inside"] as const) {
        const s = from === "outside" ? 1 : -1;
        const start = from === "outside" ? ol + 20 : 1;
        const p = { x: C.x + o.x * start, y: C.y + o.y * start, z: C.z + o.z * start };
        const v = { x: -s * o.x * 30, y: -s * o.y * 30, z: -s * o.z * 30 };
        const dt = 1 / 60;
        let hits = 0, first = -1;
        for (let k = 0; k < 240 && (first < 0 || k <= first + 30); k++) {
          p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
          if (resolveCluster(p, v, rocks)) { hits++; if (first < 0) first = k; }
          if (first >= 0 && k >= first + 3) expect(inside(p, rocks), `${name} ${from} step ${k - first}`).toBe(false);
        }
        expect(first, `${name} ${from}: reached the shell`).toBeGreaterThanOrEqual(0);
        expect(hits, `${name} ${from}: impacts in the half second after the first`).toBe(1);
      }
    }
  });

  it("every rock lies well inside NEST_ROCK_CHECK_R (40 u), the radius past which Spaceship skips them", () => {
    expect(NEST_ROCK_CHECK_R).toBe(40);
    for (const c of NEST_ROCK_COLLIDERS) {
      expect(Math.hypot(c.x - NEST_CENTRE[0], c.y - NEST_CENTRE[1], c.z - NEST_CENTRE[2]) + c.r).toBeLessThanOrEqual(NEST_ROCK_CHECK_R - 5);
    }
  });
});
