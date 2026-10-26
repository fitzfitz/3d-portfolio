import { describe, it, expect } from "vitest";
import {
  crossesGate, buildGates, sampleGhost, encodeGhost, decodeGhost,
  formatRaceTime, isNewBest, parseRaceBest, gridSlot, seedLap, GHOST_HZ, MAX_STEP, type Gate,
} from "../src/utils/race";
import {
  RING_GATES, RING_RADIUS, RACE_GATES, RACE_CENTRES, START_GATE, SEED_SPEED,
} from "../src/data/ringCourse";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../src/data/asteroids";
import { PORTAL_POS } from "../src/constants";
import { SHARDS } from "../src/data/shards";
import { SPAWN } from "../src/data/spawn";

const v = (x: number, y: number, z: number) => ({ x, y, z });
/** A gate at the origin facing +z. */
const G: Gate = { c: v(0, 0, 0), n: v(0, 0, 1) };

describe("crossesGate", () => {
  it("detects a pass through the disc", () => {
    expect(crossesGate(v(0, 0, -1), v(0, 0, 1), G, 6)).toBe(true);
  });
  it("detects a pass in the reverse direction too", () => {
    expect(crossesGate(v(1, 1, 2), v(1, 1, -2), G, 6)).toBe(true);
  });
  it("misses outside the ring", () => {
    expect(crossesGate(v(7, 0, -1), v(7, 0, 1), G, 6)).toBe(false);
  });
  it("misses when the segment stops short of the plane", () => {
    expect(crossesGate(v(0, 0, -3), v(0, 0, -0.5), G, 6)).toBe(false);
  });
  // At warp (39 u/s) the ship moves ~2 units a frame, past a ring between two
  // frames — the reason this is a segment test and not a distance check.
  it("catches a fast pass where neither endpoint is near the ring", () => {
    expect(crossesGate(v(0, 0, -2.5), v(0, 0, 2.5), G, 6)).toBe(true);
  });
  it("ignores teleports and boundary wraps", () => {
    expect(crossesGate(v(0, 0, -MAX_STEP), v(0, 0, MAX_STEP), G, 6)).toBe(false);
  });
});

describe("buildGates", () => {
  it("faces each ring along the path, as unit normals", () => {
    const gates = buildGates([[0, 0, 0], [0, 0, 10], [10, 0, 10]]);
    for (const g of gates) expect(Math.hypot(g.n.x, g.n.y, g.n.z)).toBeCloseTo(1);
    // Middle ring bisects the 90° turn: incoming +z, outgoing +x.
    expect(gates[1].n.x).toBeCloseTo(Math.SQRT1_2);
    expect(gates[1].n.z).toBeCloseTo(Math.SQRT1_2);
  });
});

/** The closed loop's length: every leg, last back to first. */
function loopLength(points: readonly (readonly number[])[]): number {
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    length += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  return length;
}

/** Clear of asteroids, the sun and data shards, by the ring margins. */
function expectClearOfScenery(x: number, y: number, z: number, what: string) {
  for (const c of [...ASTEROID_COLLIDERS, SUN_COLLIDER]) {
    expect(Math.hypot(x - c.x, y - c.y, z - c.z), `${what} vs ${c.id}`).toBeGreaterThan(c.r + RING_RADIUS + 3);
  }
  for (const s of SHARDS) {
    expect(Math.hypot(x - s.pos[0], y - s.pos[1], z - s.pos[2]), `${what} vs shard`).toBeGreaterThan(RING_RADIUS + 4);
  }
}

describe("the course layout", () => {
  const gates = RING_GATES;
  it("has a start/finish and 9 to 11 rings", () => {
    expect(gates.length).toBeGreaterThanOrEqual(10);
    expect(gates.length).toBeLessThanOrEqual(12);
  });
  // Spread out (owner, 2026-10-26: the old rings were "very close to each
  // other"): about 45 s a lap at warp, so fuel matters.
  it("is a 1,500-2,000 u loop", () => {
    const length = loopLength(gates);
    expect(length).toBeGreaterThanOrEqual(1500);
    expect(length).toBeLessThanOrEqual(2000);
  });
  it("spaces consecutive rings at least 80 u apart, last to first included", () => {
    for (let i = 0; i < gates.length; i++) {
      const a = gates[i], b = gates[(i + 1) % gates.length];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), `ring ${i}`).toBeGreaterThanOrEqual(80);
    }
  });
  it("starts within 300 u of spawn", () => {
    const [x, y, z] = gates[0];
    expect(Math.hypot(x - SPAWN.x, y - SPAWN.y, z - SPAWN.z)).toBeLessThanOrEqual(300);
  });
  it("keeps every ring clear of asteroids, the sun and data shards", () => {
    gates.forEach(([x, y, z], i) => expectClearOfScenery(x, y, z, `ring ${i}`));
  });
  // Planet-vs-ring clearance is checked against each planet's full swept orbit
  // in tests/solarClearance.test.ts (every ring is a landmark there).
  it("stays well away from the contact portal", () => {
    for (const [x, y, z] of gates) {
      expect(Math.hypot(x - PORTAL_POS[0], y - PORTAL_POS[1], z - PORTAL_POS[2])).toBeGreaterThan(40);
    }
  });
  it("spaces rings far enough apart to need flying between", () => {
    for (let i = 0; i < gates.length; i++) {
      const a = gates[i], b = gates[(i + 1) % gates.length];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(20);
    }
  });
  it("exports the start gate and the centres the server checks laps against", () => {
    expect(START_GATE).toBe(RACE_GATES[0]);
    expect(RACE_GATES.length).toBe(gates.length);
    expect(RACE_CENTRES).toBe(RING_GATES);
  });
});

describe("gridSlot", () => {
  const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    a.x * b.x + a.y * b.y + a.z * b.z;
  const g = START_GATE;
  const slots = Array.from({ length: 8 }, (_, i) => gridSlot(g, i));

  it("lines 8 slots up in two columns, 4 u either side, 14/22/30/38 u behind the gate", () => {
    slots.forEach((s, i) => {
      const rel = { x: s.p.x - g.c.x, y: s.p.y - g.c.y, z: s.p.z - g.c.z };
      const behind = -dot(rel, g.n);
      expect(behind, `slot ${i}`).toBeCloseTo(14 + 8 * Math.floor(i / 2));
      const side = Math.hypot(rel.x + behind * g.n.x, rel.y + behind * g.n.y, rel.z + behind * g.n.z);
      expect(side, `slot ${i}`).toBeCloseTo(4);
    });
    // Two columns: slots 0 and 1 on opposite sides; even slots all on one side.
    const lateral = (s: (typeof slots)[number]) => {
      const rel = { x: s.p.x - g.c.x, y: s.p.y - g.c.y, z: s.p.z - g.c.z };
      const b = dot(rel, g.n);
      return { x: rel.x - b * g.n.x, y: rel.y - b * g.n.y, z: rel.z - b * g.n.z };
    };
    expect(dot(lateral(slots[0]), lateral(slots[1]))).toBeCloseTo(-16);
    for (let i = 2; i < 8; i++) expect(dot(lateral(slots[i]), lateral(slots[i % 2]))).toBeCloseTo(16);
  });
  it("faces every slot through the gate (nose = n)", () => {
    for (const s of slots) {
      const cp = Math.cos(s.pitch);
      const nose = { x: Math.sin(s.heading) * cp, y: Math.sin(s.pitch), z: Math.cos(s.heading) * cp };
      expect(dot(nose, g.n)).toBeCloseTo(1);
    }
  });
  it("keeps every start slot clear of asteroids, the sun and data shards", () => {
    slots.forEach((s, i) => expectClearOfScenery(s.p.x, s.p.y, s.p.z, `grid slot ${i}`));
  });
});

describe("seedLap", () => {
  const lap = seedLap(RACE_GATES, SEED_SPEED);
  const length = loopLength(RING_GATES);

  it("takes between a pure-warp and a pure-cruise lap", () => {
    expect(lap.time).toBeGreaterThan(length / 39);
    expect(lap.time).toBeLessThan(length / 10.8);
    expect(lap.time).toBeCloseTo(length / SEED_SPEED, 1);
  });
  it("flies through every ring in order, then the finish", () => {
    const passed: number[] = [];
    for (let k = 1; k < lap.samples.length; k++) {
      RACE_GATES.forEach((g, i) => { if (crossesGate(lap.samples[k - 1], lap.samples[k], g, RING_RADIUS)) passed.push(i); });
    }
    expect(passed).toEqual([...RACE_GATES.keys()].slice(1).concat(0));
  });
  it("starts and ends at the start gate", () => {
    const first = lap.samples[0], last = lap.samples[lap.samples.length - 1];
    expect(Math.hypot(first.x - START_GATE.c.x, first.y - START_GATE.c.y, first.z - START_GATE.c.z)).toBeCloseTo(0);
    expect(Math.hypot(last.x - START_GATE.c.x, last.y - START_GATE.c.y, last.z - START_GATE.c.z)).toBeCloseTo(0);
  });
  it("never moves more than one tick at seed speed between samples", () => {
    for (let k = 1; k < lap.samples.length; k++) {
      const a = lap.samples[k - 1], b = lap.samples[k];
      expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThanOrEqual(SEED_SPEED / GHOST_HZ + 0.01);
    }
  });
  it("faces the way it flies", () => {
    let straight = 0;
    for (let k = 1; k < lap.samples.length; k++) {
      const a = lap.samples[k - 1], b = lap.samples[k];
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      // Full-length steps lie on one leg; steps that cut a corner are shorter.
      if (d < SEED_SPEED / GHOST_HZ - 1e-6) continue;
      straight++;
      const cp = Math.cos(a.pitch);
      const nose = { x: Math.sin(a.yaw) * cp, y: Math.sin(a.pitch), z: Math.cos(a.yaw) * cp };
      expect((nose.x * (b.x - a.x) + nose.y * (b.y - a.y) + nose.z * (b.z - a.z)) / d).toBeCloseTo(1, 5);
    }
    expect(straight).toBeGreaterThan(lap.samples.length * 0.9);
  });
  it("plays back through sampleGhost for the whole lap", () => {
    expect(sampleGhost(lap.samples, lap.time - 0.2)).not.toBeNull();
    expect(lap.samples.length).toBe(Math.ceil(lap.time * GHOST_HZ - 1e-9) + 1);
  });
});

describe("ghost", () => {
  // Two samples, 1/GHOST_HZ apart.
  const samples = [
    { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 },
    { x: 10, y: 2, z: -4, yaw: 1, pitch: 0.2 },
  ];
  it("interpolates between samples", () => {
    const g = sampleGhost(samples, 0.5 / GHOST_HZ)!;
    expect(g.x).toBeCloseTo(5);
    expect(g.yaw).toBeCloseTo(0.5);
  });
  it("turns the short way round across ±π", () => {
    const g = sampleGhost([{ ...samples[0], yaw: 3.1 }, { ...samples[1], yaw: -3.1 }], 0.5 / GHOST_HZ)!;
    expect(Math.abs(Math.abs(g.yaw) - Math.PI)).toBeLessThan(0.05);
  });
  it("is gone after its run ends", () => {
    expect(sampleGhost(samples, 5)).toBeNull();
  });
  it("survives a round trip through storage", () => {
    const back = decodeGhost(encodeGhost({ time: 41.25, samples }));
    expect(back?.time).toBe(41.25);
    expect(back?.samples[1].x).toBeCloseTo(10);
    expect(back?.samples[1].pitch).toBeCloseTo(0.2);
  });
  it("rejects malformed stored data instead of throwing", () => {
    expect(decodeGhost("not json")).toBeNull();
    expect(decodeGhost(JSON.stringify({ v: 99 }))).toBeNull();
    expect(decodeGhost(null)).toBeNull();
  });
});

describe("formatting and records", () => {
  it("formats as m:ss.t", () => {
    expect(formatRaceTime(41.27)).toBe("0:41.2");
    expect(formatRaceTime(83.06)).toBe("1:23.0");
  });
  it("treats any finish as a best when there is none yet", () => {
    expect(isNewBest(50, null)).toBe(true);
    expect(isNewBest(50, 49)).toBe(false);
    expect(isNewBest(48, 49)).toBe(true);
  });
});

describe("parseRaceBest", () => {
  // localStorage is user-editable; a junk record must not become a "best".
  it("accepts a positive finite time", () => {
    expect(parseRaceBest(41.2)).toBe(41.2);
  });
  it("rejects anything else", () => {
    for (const bad of [null, "41", -3, 0, Number.NaN, Infinity, {}]) expect(parseRaceBest(bad)).toBeNull();
  });
});

describe("review fixes", () => {
  // A position landing exactly on the plane must count once, not on both the
  // step that reaches it and the step that leaves it.
  it("counts a crossing through an exact on-plane point once", () => {
    const onPlane = v(0, 0, 0);
    expect(crossesGate(v(0, 0, -1), onPlane, G, 6) && crossesGate(onPlane, v(0, 0, 1), G, 6)).toBe(false);
  });
});
