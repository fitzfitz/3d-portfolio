import { describe, it, expect } from "vitest";
import projects from "../src/data/projects.json";
import { SPAWN } from "../src/data/spawn";
import { SYSTEM_RADIUS, SUN_RADIUS } from "../src/constants";
import { SUN_COLLIDER } from "../src/data/asteroids";
import { PLANETS_AND_WORLDS } from "../src/data/worlds";
import { orbitPosition } from "../src/utils/orbits";
import { PROBES, PROBE_IDS, PROBE_RADIUS } from "../src/data/probes";
import {
  loadProbeSpots, nextSpot, spotPos, RELOCATE_S, relocationTravel, beaconLevel,
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
    for (const b of PLANETS_AND_WORLDS) {
      const c = orbitPosition(b.orbit, 0);
      expect(segDist(S, first.home, [c.x, c.y, c.z]), b.key).toBeGreaterThan(b.reach);
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
  it("is 0 at 0, 60 at RELOCATE_S, monotonic and accelerating", () => {
    expect(relocationTravel(0)).toBe(0);
    expect(Math.abs(relocationTravel(RELOCATE_S) - 60)).toBeLessThan(1e-9);
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
