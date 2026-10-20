import { describe, it, expect } from "vitest";
import projects from "../src/data/projects.json";
import { SPAWN } from "../src/data/spawn";
import { SYSTEM_RADIUS, SUN_RADIUS } from "../src/constants";
import { SUN_COLLIDER } from "../src/data/asteroids";
import { BODY_ORBITS } from "./helpers/solarClearance";
import { beltClearance } from "./helpers/clearance";
import { ASTEROID_COLLIDERS } from "../src/data/asteroids";
import { SHARDS } from "../src/data/shards";
import { DESTINATIONS } from "../src/data/destinations";
import { GATE_POS, GATE_KEEP_OUT } from "../src/data/dormantGate";
import { BUOYS, BUOY_CARD_R } from "../src/data/careerTrail";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import { CRYSTAL_PICKUP_RADIUS } from "../src/utils/crystalField";
import { PROBES, PROBE_IDS, PROBE_RADIUS } from "../src/data/probes";
import {
  loadProbeSpots, nextSpot, spotPos, RELOCATE_S, RELOCATE_DIST, relocationTravel, beaconLevel,
  POP_FADE_S, ARRIVE_S, relocationScale, arrivalScale, burnPlume,
} from "../src/utils/probes";

const S = [SPAWN.x, SPAWN.y, SPAWN.z] as const;
const d3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Distance from point c to the segment a-b. */
function segDist(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const t = Math.max(0, Math.min(1, (ab[0] * ac[0] + ab[1] * ac[1] + ab[2] * ac[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return Math.hypot(ac[0] - t * ab[0], ac[1] - t * ab[1], ac[2] - t * ab[2]);
}

describe("probe table", () => {
  it("lists the project ids in projects.json order", () => {
    expect(PROBE_IDS).toEqual(projects.map((p) => p.id));
    expect(PROBES.map((p) => p.id)).toEqual(PROBE_IDS);
  });

  it("gives every probe 6 to 8 remote spots", () => {
    for (const p of PROBES) {
      expect(p.remote.length, p.id).toBeGreaterThanOrEqual(6);
      expect(p.remote.length, p.id).toBeLessThanOrEqual(8);
    }
  });

  it("keeps every home within 90 u of the spawn", () => {
    for (const p of PROBES) expect(d3(p.home, S), p.id).toBeLessThanOrEqual(90);
  });

  it("puts probe 1's home nearest the spawn, within 45 u, on a clear straight line", () => {
    const [first, ...rest] = PROBES;
    const d1 = d3(first.home, S);
    expect(d1).toBeLessThanOrEqual(45);
    for (const p of rest) expect(d3(p.home, S), p.id).toBeGreaterThan(d1);
    expect(segDist(S, first.home, [0, 0, 0])).toBeGreaterThan(Math.max(SUN_RADIUS, SUN_COLLIDER.r));
    // The line clears every body's whole swept orbit, well and moon system included.
    for (const o of BODY_ORBITS) {
      for (const q of o.pts) expect(segDist(S, first.home, q), o.name).toBeGreaterThan(o.keepOut);
    }
  });

  it("scatters every remote spot 150 to 420 u from the spawn, inside the system", () => {
    for (const p of PROBES) {
      for (const r of p.remote) {
        expect(d3(r, S), p.id).toBeGreaterThanOrEqual(150);
        expect(d3(r, S), p.id).toBeLessThanOrEqual(420);
        expect(Math.hypot(r[0], r[1], r[2]), p.id).toBeLessThanOrEqual(SYSTEM_RADIUS - 60);
      }
    }
  });

  it("has a positive probe radius", () => {
    expect(PROBE_RADIUS).toBe(1.6);
  });
});

describe("spot cycling", () => {
  it("cycles 0, 1 ... n, then back to 1 (never 0)", () => {
    for (const p of PROBES) {
      const n = p.remote.length;
      let s = 0;
      const seen: number[] = [];
      for (let i = 0; i < n + 2; i++) { s = nextSpot(p, s); seen.push(s); }
      expect(seen).toEqual([...Array.from({ length: n }, (_, i) => i + 1), 1, 2]);
    }
  });

  it("resolves spot 0 to home and k to remote[k-1]", () => {
    for (const p of PROBES) {
      expect(spotPos(p, 0)).toEqual(p.home);
      p.remote.forEach((r, i) => expect(spotPos(p, i + 1)).toEqual(r));
    }
  });
});

describe("loadProbeSpots", () => {
  const zeros = Object.fromEntries(PROBE_IDS.map((id) => [id, 0]));
  it("gives all zeros for junk", () => {
    expect(loadProbeSpots(null)).toEqual(zeros);
    expect(loadProbeSpots([])).toEqual(zeros);
    expect(loadProbeSpots("x")).toEqual(zeros);
  });
  it("zeroes invalid values", () => {
    expect(loadProbeSpots({ ruangrapi: 2.5 }).ruangrapi).toBe(0);
    expect(loadProbeSpots({ ruangrapi: -1 }).ruangrapi).toBe(0);
    expect(loadProbeSpots({ ruangrapi: 99 }).ruangrapi).toBe(0);
    expect(loadProbeSpots({ ruangrapi: "2" }).ruangrapi).toBe(0);
  });
  it("drops unknown ids and keeps valid spots", () => {
    const out = loadProbeSpots({ nope: 1, portfolio: 3 });
    expect(Object.keys(out).sort()).toEqual([...PROBE_IDS].sort());
    expect(out.portfolio).toBe(3);
  });
});

describe("relocationTravel", () => {
  it("is 0 at 0, RELOCATE_DIST (90) at RELOCATE_S, monotonic and accelerating", () => {
    expect(relocationTravel(0)).toBe(0);
    expect(RELOCATE_DIST).toBe(90);
    expect(Math.abs(relocationTravel(RELOCATE_S) - RELOCATE_DIST)).toBeLessThan(1e-9);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = relocationTravel((i / 100) * RELOCATE_S);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    const h = 0.01;
    for (let t = h; t < RELOCATE_S - h; t += 0.1) {
      const second = relocationTravel(t + h) - 2 * relocationTravel(t) + relocationTravel(t - h);
      expect(second).toBeGreaterThan(0);
    }
  });
});

// Final review (spec §4.2 call 6): the probe dwindles out before the snap, so
// the pop to its new spot never shows a full-size probe vanishing.
describe("relocationScale / arrivalScale / burnPlume", () => {
  it("holds full size until the last POP_FADE_S, then eases to 0 at the snap", () => {
    expect(POP_FADE_S).toBeGreaterThanOrEqual(0.25);
    expect(POP_FADE_S).toBeLessThanOrEqual(0.5);
    expect(relocationScale(0)).toBe(1);
    expect(relocationScale(RELOCATE_S - POP_FADE_S)).toBe(1);
    expect(relocationScale(RELOCATE_S - POP_FADE_S / 2)).toBeCloseTo(0.5, 6);
    expect(relocationScale(RELOCATE_S)).toBe(0);
    let prev = 1;
    for (let t = 0; t <= RELOCATE_S; t += 0.01) {
      const v = relocationScale(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });
  it("grows a relocated probe back in over ARRIVE_S; instantly under reduced motion", () => {
    expect(arrivalScale(0, false)).toBe(0);
    expect(arrivalScale(ARRIVE_S / 2, false)).toBeCloseTo(0.5, 6);
    expect(arrivalScale(ARRIVE_S, false)).toBe(1);
    expect(arrivalScale(0, true)).toBe(1);
  });
  it("lights the plume just after the close, holds it, and dies with the probe", () => {
    expect(burnPlume(0)).toBe(0);
    expect(burnPlume(0.5)).toBe(1);
    expect(burnPlume(1.5)).toBe(1);
    expect(burnPlume(RELOCATE_S)).toBe(0);
    for (let t = 0; t <= RELOCATE_S; t += 0.01) expect(burnPlume(t)).toBeLessThanOrEqual(relocationScale(t));
  });
});

describe("beaconLevel", () => {
  it("stays in [0,1], at most 1.5 Hz, with no hard steps", () => {
    for (const phase of [0, 1.3, 4]) {
      let up = 0, maxStep = 0, lo = Infinity, hi = -Infinity;
      let prev = beaconLevel(0, phase);
      for (let i = 1; i <= 10000; i++) {
        const v = beaconLevel(i / 1000, phase);
        lo = Math.min(lo, v); hi = Math.max(hi, v);
        if (prev < 0.5 && v >= 0.5) up++;
        maxStep = Math.max(maxStep, Math.abs(v - prev));
        prev = v;
      }
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(up).toBeLessThanOrEqual(15);
      expect(maxStep).toBeLessThanOrEqual(0.02);
    }
  });
});

describe("project probes clear the other fixed things they could touch (orbits: tests/solarClearance.test.ts)", () => {
  const MARGIN = 4;
  const spots = PROBES.flatMap((p) => [
    { name: `${p.id} home`, pos: p.home },
    ...p.remote.map((r, i) => ({ name: `${p.id} remote ${i + 1}`, pos: r })),
  ]);

  it("clears the sun, the asteroid belt and the halo", () => {
    for (const s of spots) {
      expect(Math.hypot(s.pos[0], s.pos[1], s.pos[2]), `${s.name} vs sun`).toBeGreaterThan(SUN_COLLIDER.r + PROBE_RADIUS + MARGIN);
      expect(beltClearance(s.pos, 0.436, 40, 70, 2.5), `${s.name} vs belt`).toBeGreaterThan(PROBE_RADIUS);
      expect(beltClearance(s.pos, 1.31, 80, 95, 4.5), `${s.name} vs halo`).toBeGreaterThan(PROBE_RADIUS);
    }
  });

  it("clears destinations, the gate, shards, career buoys, ring-course gates and scenery asteroids", () => {
    for (const s of spots) {
      for (const d of DESTINATIONS) expect(d3(s.pos, d.pos), `${s.name} vs ${d.id}`).toBeGreaterThan(d.zoneR + PROBE_RADIUS + MARGIN);
      expect(d3(s.pos, GATE_POS), `${s.name} vs gate`).toBeGreaterThan(GATE_KEEP_OUT + PROBE_RADIUS);
      SHARDS.forEach((sh, i) => expect(d3(s.pos, sh.pos), `${s.name} vs shard ${i}`).toBeGreaterThan(CRYSTAL_PICKUP_RADIUS + PROBE_RADIUS + MARGIN));
      for (const b of BUOYS) expect(d3(s.pos, b.pos), `${s.name} vs ${b.id}`).toBeGreaterThan(BUOY_CARD_R + PROBE_RADIUS + MARGIN);
      RING_GATES.forEach((g, i) => expect(d3(s.pos, g), `${s.name} vs ring ${i}`).toBeGreaterThan(RING_RADIUS + PROBE_RADIUS + MARGIN));
      for (const a of ASTEROID_COLLIDERS) expect(d3(s.pos, [a.x, a.y, a.z]), `${s.name} vs ${a.id}`).toBeGreaterThan(a.r + PROBE_RADIUS + 2);
    }
  });

  it("keeps probes clear of each other", () => {
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(d3(spots[i].pos, spots[j].pos), `${spots[i].name} vs ${spots[j].name}`).toBeGreaterThan(30);
      }
    }
  });
});
