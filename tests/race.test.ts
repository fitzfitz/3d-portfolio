import { describe, it, expect } from "vitest";
import {
  crossesGate, buildGates, raceStep, sampleGhost, encodeGhost, decodeGhost,
  formatRaceTime, isNewBest, parseRaceBest, GHOST_HZ, MAX_STEP, type Gate, type RaceState,
} from "../src/utils/race";
import { RING_GATES, RING_RADIUS, PAR_SECONDS } from "../src/data/ringCourse";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../src/data/asteroids";
import { PLANET_ORBITS, PORTAL_POS } from "../src/constants";
import { SHARDS } from "../src/data/shards";

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

describe("the course layout", () => {
  const gates = RING_GATES;
  it("has a start/finish and at least eight rings", () => {
    expect(gates.length).toBeGreaterThanOrEqual(9);
  });
  it("keeps every ring clear of asteroids, the sun and data shards", () => {
    for (const [x, y, z] of gates) {
      for (const c of [...ASTEROID_COLLIDERS, SUN_COLLIDER]) {
        expect(Math.hypot(x - c.x, y - c.y, z - c.z)).toBeGreaterThan(c.r + RING_RADIUS + 3);
      }
      for (const s of SHARDS) {
        expect(Math.hypot(x - s.pos[0], y - s.pos[1], z - s.pos[2])).toBeGreaterThan(RING_RADIUS + 4);
      }
    }
  });
  it("stays inside every planet orbit, so a planet never drifts through a ring", () => {
    const innermost = Math.min(...Object.values(PLANET_ORBITS).map((o) => o.radius));
    for (const [x, y, z] of gates) expect(Math.hypot(x, y, z)).toBeLessThan(innermost - 4.8 * 2 - RING_RADIUS);
  });
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
  it("sets par slower than pure warp and faster than pure cruise", () => {
    let length = 0;
    for (let i = 0; i < gates.length; i++) {
      const a = gates[i], b = gates[(i + 1) % gates.length];
      length += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    expect(PAR_SECONDS).toBeGreaterThan(length / 39);
    expect(PAR_SECONDS).toBeLessThan(length / 10.8);
  });
});

describe("raceStep", () => {
  // Three rings in a line along +z: start/finish at 0, then 20, then 40.
  const gates = buildGates([[0, 0, 0], [0, 0, 20], [0, 0, 40]]);
  const through = (z: number) => [v(0, 0, z - 1), v(0, 0, z + 1)] as const;
  const step = (s: RaceState, z: number, clock: number) => raceStep(s, ...through(z), clock, gates, 6);

  it("starts the clock through the start gate", () => {
    const r = step({ phase: "idle" }, 0, 5);
    expect(r.event).toBe("start");
    expect(r.state).toEqual({ phase: "running", next: 1, startClock: 5 });
  });
  it("advances only through the next ring, in order", () => {
    const running: RaceState = { phase: "running", next: 1, startClock: 5 };
    expect(step(running, 40, 6)).toEqual({ state: running, event: null });
    const r = step(running, 20, 7);
    expect(r.event).toBe("gate");
    expect(r.state).toEqual({ phase: "running", next: 2, startClock: 5 });
  });
  it("does not finish by doubling back through the start gate early", () => {
    const running: RaceState = { phase: "running", next: 1, startClock: 5 };
    expect(step(running, 0, 6).event).toBe(null);
  });
  it("finishes back through the start gate after the last ring", () => {
    const r = step({ phase: "running", next: 0, startClock: 5 }, 0, 47.5);
    expect(r.event).toBe("finish");
    expect(r.state).toEqual({ phase: "finished", time: 42.5 });
  });
  it("advances from the last ring to the finish", () => {
    const r = step({ phase: "running", next: 2, startClock: 5 }, 40, 30);
    expect(r.state).toEqual({ phase: "running", next: 0, startClock: 5 });
  });
  it("starts a new run from the finished state", () => {
    expect(step({ phase: "finished", time: 42 }, 0, 60).event).toBe("start");
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
