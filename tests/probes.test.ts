import { describe, it, expect } from "vitest";
import projects from "../src/data/projects.json";
import { SPAWN } from "../src/data/spawn";
import { SYSTEM_RADIUS, SUN_RADIUS } from "../src/constants";
import { SUN_COLLIDER } from "../src/data/asteroids";
import { BODY_ORBITS } from "./helpers/solarClearance";
import { ASTEROID_COLLIDERS } from "../src/data/asteroids";
import { SHARDS } from "../src/data/shards";
import { DESTINATIONS } from "../src/data/destinations";
import { GATE_POS, GATE_KEEP_OUT } from "../src/data/dormantGate";
import { BUOY_CARD_R, possibleBuoyPositions } from "../src/data/careerTrail";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import { CRYSTAL_PICKUP_RADIUS } from "../src/utils/crystalField";
import { PROBES, PROBE_IDS, PROBE_RADIUS, PROBE_SLOTS, MAX_PROBES, assignProbes } from "../src/data/probes";
import { vi } from "vitest";
import {
  loadProbeSpots, nextSpot, spotPos, RELOCATE_S, RELOCATE_DIST, relocationTravel, beaconLevel,
  POP_FADE_S, ARRIVE_S, relocationScale, arrivalScale, burnPlume, burnFlare, FLARE_CLEAR_DIST, FLARE_FULL_DIST,
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

/** Every slot, named for failure messages: "slot 1" is the first project's. */
const SLOTS = PROBE_SLOTS.map((slot, i) => ({ id: `slot ${i + 1}`, ...slot }));

describe("probe table", () => {
  it("lists the project ids in projects.json order, on slots 1, 2, 3", () => {
    expect(PROBE_IDS).toEqual(projects.map((p) => p.id));
    expect(PROBES.map((p) => p.id)).toEqual(PROBE_IDS);
    PROBES.forEach((p, i) => {
      expect(p.home).toBe(PROBE_SLOTS[i].home);
      expect(p.remote).toBe(PROBE_SLOTS[i].remote);
    });
  });

  // spec 2026-10-23-dynamic-content, decision 6: today's three projects stay exactly where they were.
  // main's three probes (ruangrapi, portfolio, fuxx) before slots existed, literal: every home and remote spot.
  it("keeps slots 1-3 where the three probes always were", () => {
    expect(PROBE_SLOTS.slice(0, 3).map((s) => ({ home: [...s.home], remote: s.remote.map((r) => [...r]) }))).toEqual([
      { home: [-30, 80, 48], remote: [[-37, 413, -7], [-160, -53, -298], [60, -202, -236], [217, 354, -56], [261, 83, 190], [24, 31, 321], [-242, -251, 228]] },
      { home: [-111, 60, 100], remote: [[-292, 24, -134], [-112, 312, -235], [10, -342, -15], [338, 126, -9], [126, -289, 216], [-177, -12, 273], [-322, 9, 114]] },
      { home: [-67, 102, -7], remote: [[-204, -268, -138], [75, 76, -307], [287, -119, -88], [169, -67, 121], [27, 327, 259], [-209, 259, 237], [-314, 277, 5]] },
    ]);
  });

  it("holds six probes: with the three destinations, the number keys 1-9 reach them all", () => {
    expect(MAX_PROBES).toBe(6);
    expect(MAX_PROBES + DESTINATIONS.length).toBeLessThanOrEqual(9);
  });

  it("gives the first six projects slots in order, and the rest no probe, with a warning", () => {
    const warn = vi.fn<(msg: string) => void>();
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const defs = assignProbes(ids, warn);
    expect(defs.map((d) => d.id)).toEqual(ids.slice(0, 6));
    defs.forEach((d, i) => expect(d.home).toBe(PROBE_SLOTS[i].home));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/g, h/);
    expect(assignProbes(["solo"], warn).map((d) => d.home)).toEqual([PROBE_SLOTS[0].home]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("gives every slot 6 to 8 remote spots", () => {
    for (const p of SLOTS) {
      expect(p.remote.length, p.id).toBeGreaterThanOrEqual(6);
      expect(p.remote.length, p.id).toBeLessThanOrEqual(8);
    }
  });

  it("keeps every home within 90 u of the spawn", () => {
    for (const p of SLOTS) expect(d3(p.home, S), p.id).toBeLessThanOrEqual(90);
  });

  it("puts slot 1's home nearest the spawn, within 45 u, on a clear straight line", () => {
    const [first, ...rest] = SLOTS;
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
    for (const p of SLOTS) {
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
    for (const p of SLOTS) {
      const n = p.remote.length;
      let s = 0;
      const seen: number[] = [];
      for (let i = 0; i < n + 2; i++) { s = nextSpot(p, s); seen.push(s); }
      expect(seen).toEqual([...Array.from({ length: n }, (_, i) => i + 1), 1, 2]);
    }
  });

  it("resolves spot 0 to home and k to remote[k-1]", () => {
    for (const p of SLOTS) {
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
  // The nozzle flare is for range, where the probe is a few pixels and the
  // plume a streak: up close it covered the main engine bell, so it fades in
  // with the camera's distance and the plume carries the burn there.
  it("fades the nozzle flare in with range: none up close, full past FLARE_FULL_DIST, smooth between", () => {
    expect(burnFlare(0)).toBe(0);
    expect(burnFlare(FLARE_CLEAR_DIST)).toBe(0);
    expect(burnFlare(FLARE_FULL_DIST)).toBe(1);
    expect(burnFlare(500)).toBe(1);
    expect(burnFlare((FLARE_CLEAR_DIST + FLARE_FULL_DIST) / 2)).toBeCloseTo(0.5, 6);
    let prev = 0;
    for (let d = 0; d <= FLARE_FULL_DIST + 5; d += 0.25) {
      expect(burnFlare(d)).toBeGreaterThanOrEqual(prev);
      prev = burnFlare(d);
    }
    // Where the chase camera watches a burn start (the probe 4 u off the
    // nose when its dossier closes, the camera ~5 u behind), the bell is clear.
    expect(FLARE_CLEAR_DIST).toBeGreaterThanOrEqual(14);
    // ...and by the time the probe is ~25 px across (3 u long at 45 u), the flare is all there.
    expect(FLARE_FULL_DIST).toBeLessThanOrEqual(50);
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

describe("every probe slot clears the other fixed things it could touch (orbits: tests/solarClearance.test.ts)", () => {
  const MARGIN = 4;
  const spots = SLOTS.flatMap((p) => [
    { name: `${p.id} home`, pos: p.home },
    ...p.remote.map((r, i) => ({ name: `${p.id} remote ${i + 1}`, pos: r })),
  ]);

  // Belt and Trojan clearance: tests/solarClearance.test.ts (real swept orbits).
  it("clears the sun", () => {
    for (const s of spots) {
      expect(Math.hypot(s.pos[0], s.pos[1], s.pos[2]), `${s.name} vs sun`).toBeGreaterThan(SUN_COLLIDER.r + PROBE_RADIUS + MARGIN);
    }
  });

  it("clears destinations, the gate, shards, career buoys, ring-course gates and scenery asteroids", () => {
    for (const s of spots) {
      for (const d of DESTINATIONS) expect(d3(s.pos, d.pos), `${s.name} vs ${d.id}`).toBeGreaterThan(d.zoneR + PROBE_RADIUS + MARGIN);
      expect(d3(s.pos, GATE_POS), `${s.name} vs gate`).toBeGreaterThan(GATE_KEEP_OUT + PROBE_RADIUS);
      SHARDS.forEach((sh, i) => expect(d3(s.pos, sh.pos), `${s.name} vs shard ${i}`).toBeGreaterThan(CRYSTAL_PICKUP_RADIUS + PROBE_RADIUS + MARGIN));
      possibleBuoyPositions().forEach((b, i) => expect(d3(s.pos, b), `${s.name} vs buoy spot ${i}`).toBeGreaterThan(BUOY_CARD_R + PROBE_RADIUS + MARGIN));
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
