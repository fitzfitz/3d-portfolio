import { describe, it, expect } from "vitest";
import { PORTAL_POS, PORTAL_ZONE_R } from "../src/constants";
import { BUNDLED_CAREER as career, type CareerEntry } from "../src/data/career";
import { SHARDS } from "../src/data/shards";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../src/data/asteroids";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import {
  STATION_POS, STATION_RADII, BUOYS, BUOY_CARD_R, TRAIL_ARC, arcThrough, arcPoint, startKey, type Vec3,
  buildBuoys, MAX_BUOYS, possibleBuoyPositions,
} from "../src/data/careerTrail";
import { SPAWN } from "../src/data/spawn";
import { PROBES } from "../src/data/probes";
import { headingToward } from "../src/utils/pitchFlight";
import { d3, MARGIN } from "./helpers/clearance";
import { landmarkMargin, worstRule } from "./helpers/solarClearance";
import { vi } from "vitest";

const SPAWN_V: Vec3 = [SPAWN.x, SPAWN.y, SPAWN.z];
/** Each landmark with its keep-out: the station's proximity zone, a buoy's card radius. */
const PLACES: { name: string; pos: Vec3; keepOut: number }[] = [
  { name: "station", pos: STATION_POS, keepOut: STATION_RADII.zoneR },
  ...BUOYS.map((b) => ({ name: b.id, pos: b.pos, keepOut: BUOY_CARD_R })),
];

describe("arcThrough", () => {
  it("finds the circle through three points and the span from the first to the last", () => {
    const arc = arcThrough([1, 0, 0], [0, 1, 0], [-1, 0, 0]);
    expect(arc.radius).toBeCloseTo(1);
    arc.centre.forEach((v) => expect(v).toBeCloseTo(0));
    expect(arc.span).toBeCloseTo(Math.PI);
    const mid = arcPoint(arc, 0.5);
    expect(mid[0]).toBeCloseTo(0);
    expect(mid[1]).toBeCloseTo(1);
  });
  it("refuses three points on one line", () => {
    expect(() => arcThrough([0, 0, 0], [1, 1, 1], [2, 2, 2])).toThrow(/collinear/);
  });
});

describe("career trail order", () => {
  it("has one buoy per career entry, oldest first", () => {
    expect(BUOYS).toHaveLength(career.length);
    expect(new Set(BUOYS.map((b) => b.entry))).toEqual(new Set(career));
    for (let i = 1; i < BUOYS.length; i++) expect(startKey(BUOYS[i].entry)).toBeGreaterThan(startKey(BUOYS[i - 1].entry));
    expect(BUOYS[0].entry.company).toBe("SoftwareSeni");
    expect(BUOYS[BUOYS.length - 1].entry.company).toBe("Hubexo");
  });
  it("names each buoy career_<n> and labels it with its start year", () => {
    BUOYS.forEach((b, i) => {
      expect(b.id).toBe(`career_${i}`);
      expect(b.label).toBe(`CAREER_${b.entry.start.slice(-4)}`);
    });
  });
  it("rejects a start date it cannot read", () => {
    expect(() => startKey({ ...career[0], start: "Sometime 2015" })).toThrow(/unreadable/);
  });
});

describe("career trail shape", () => {
  it("puts every buoy on the guide arc, evenly spaced and at least 20 apart", () => {
    for (const b of BUOYS) expect(d3(b.pos, TRAIL_ARC.centre)).toBeCloseTo(TRAIL_ARC.radius, 6);
    const gaps = BUOYS.slice(1).map((b, i) => d3(b.pos, BUOYS[i].pos));
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(20);
      expect(g).toBeCloseTo(gaps[0], 6);
    }
  });
  it("starts 30-45 units from the spawn point and ends 15-25 from the station", () => {
    const first = d3(BUOYS[0].pos, SPAWN_V);
    const last = d3(BUOYS[BUOYS.length - 1].pos, STATION_POS);
    expect(first).toBeGreaterThanOrEqual(30);
    expect(first).toBeLessThanOrEqual(45);
    expect(last).toBeGreaterThanOrEqual(15);
    expect(last).toBeLessThanOrEqual(25);
  });
  it("keeps the whole arc 60+ from the sun and the buoys no more than 50 apart", () => {
    for (let k = 0; k <= 400; k++) {
      const p = arcPoint(TRAIL_ARC, k / 400);
      expect(d3(p, [SUN_COLLIDER.x, SUN_COLLIDER.y, SUN_COLLIDER.z]), `arc t=${k / 400}`).toBeGreaterThanOrEqual(60);
    }
    for (let i = 1; i < BUOYS.length; i++) expect(d3(BUOYS[i].pos, BUOYS[i - 1].pos)).toBeLessThanOrEqual(50);
  });
  it("climbs out of the ecliptic: every buoy above the last, the station above them all", () => {
    for (let i = 1; i < BUOYS.length; i++) expect(BUOYS[i].pos[1]).toBeGreaterThan(BUOYS[i - 1].pos[1]);
    expect(BUOYS[0].pos[1]).toBeGreaterThan(SPAWN.y);
    expect(STATION_POS[1]).toBeGreaterThan(BUOYS[BUOYS.length - 1].pos[1]);
  });
  it("puts the first buoy ahead of the spawn pad, in the opening view", () => {
    // The ship spawns nosed at probe 1 (Spaceship.tsx); the chase camera
    // frames about ±40° across. Within ±35° of that heading and 30° of level
    // is on screen from the first frame.
    const heading = headingToward(SPAWN.x, SPAWN.z, PROBES[0].home[0], PROBES[0].home[2]);
    const [dx, dy, dz] = [BUOYS[0].pos[0] - SPAWN.x, BUOYS[0].pos[1] - SPAWN.y, BUOYS[0].pos[2] - SPAWN.z];
    const off = Math.atan2(Math.sin(Math.atan2(dx, dz) - heading), Math.cos(Math.atan2(dx, dz) - heading));
    expect(Math.abs(off) * (180 / Math.PI)).toBeLessThanOrEqual(35);
    expect(Math.abs(Math.atan2(dy, Math.hypot(dx, dz))) * (180 / Math.PI)).toBeLessThanOrEqual(30);
  });
});

describe("career landmark clearance", () => {
  it("never shares space with a body's swept orbit, its well, its moons, or a belt, Trojan or comet orbit", () => {
    for (const p of PLACES) {
      expect(landmarkMargin(p.pos, p.keepOut), `${p.name} vs ${worstRule(p.pos, p.keepOut)}`).toBeGreaterThan(0);
    }
  });
  it("keeps the whole flight, first buoy to the station's dock, out of them too (no waivers)", () => {
    // The guide arc every 1/32 (~5 u) and the leg from the last buoy into the
    // station, each point held at a buoy's card radius: a pilot who follows the
    // trail never crosses a swept well or a rock orbit's tube.
    const last = BUOYS[BUOYS.length - 1].pos;
    const leg: Vec3[] = [0.25, 0.5, 0.75].map((t) => [
      last[0] + (STATION_POS[0] - last[0]) * t, last[1] + (STATION_POS[1] - last[1]) * t, last[2] + (STATION_POS[2] - last[2]) * t,
    ]);
    for (const p of [...Array.from({ length: 33 }, (_, k) => arcPoint(TRAIL_ARC, k / 32)), ...leg]) {
      expect(landmarkMargin(p, BUOY_CARD_R), `trail ${p.map((v) => v.toFixed(0)).join(",")} vs ${worstRule(p, BUOY_CARD_R)}`).toBeGreaterThan(0);
    }
  }, 60_000);
  it("keeps clear of the sun, the contact portal and the scenery asteroids", () => {
    for (const p of PLACES) {
      expect(d3(p.pos, [SUN_COLLIDER.x, SUN_COLLIDER.y, SUN_COLLIDER.z]), `sun vs ${p.name}`)
        .toBeGreaterThan(SUN_COLLIDER.r + p.keepOut + MARGIN);
      expect(d3(p.pos, PORTAL_POS), `portal vs ${p.name}`).toBeGreaterThan(PORTAL_ZONE_R + p.keepOut + 40);
      for (const a of ASTEROID_COLLIDERS) {
        expect(d3(p.pos, [a.x, a.y, a.z]), `${a.id} vs ${p.name}`).toBeGreaterThan(a.r + p.keepOut + MARGIN);
      }
    }
  });
  it("keeps clear of every time-trial ring and every data shard", () => {
    for (const p of PLACES) {
      RING_GATES.forEach((g, i) => {
        expect(d3(p.pos, g), `gate ${i} vs ${p.name}`).toBeGreaterThan(RING_RADIUS + p.keepOut);
      });
      SHARDS.forEach((s, i) => {
        expect(d3(p.pos, s.pos), `shard ${i} vs ${p.name}`).toBeGreaterThan(p.keepOut + MARGIN);
      });
    }
  });
});

/** n jobs, oldest first, one a year from 2000 (any order works: buildBuoys sorts by start). */
const jobs = (n: number): CareerEntry[] => Array.from({ length: n }, (_, i) => ({
  ...career[0], role: `Role ${i}`, company: `Co ${i}`, start: `Mar ${2000 + i}`, end: `Feb ${2001 + i}`,
}));
const gapsOf = (pos: readonly Vec3[]) => pos.slice(1).map((p, i) => d3(p, pos[i]));

// The trail derives from the list (spec 2026-10-23-dynamic-content, build
// ruling R7): 1 to 12 entries, one step 1 / max(n - 1, 4) of the arc.
describe("career trail over the supported range (1 to MAX_BUOYS entries)", () => {
  const SIZES = [1, 2, 3, 4, 5, 6, 9, 10, 12];

  it("supports twelve entries", () => {
    expect(MAX_BUOYS).toBe(12);
  });

  it("lays five entries out exactly as the bundled trail always was", () => {
    expect(BUOYS.map((b) => b.pos)).toEqual([0, 1, 2, 3, 4].map((i) => arcPoint(TRAIL_ARC, i / 4)));
    expect(buildBuoys(jobs(5)).map((b) => b.pos)).toEqual(BUOYS.map((b) => b.pos));
  });

  it.each(SIZES)("%i entries: one buoy each, oldest first, on the arc from its start, 15 to 50 apart", (n) => {
    const b = buildBuoys([...jobs(n)].reverse());
    expect(b).toHaveLength(n);
    b.forEach((x, i) => {
      expect(x.entry.company).toBe(`Co ${i}`);
      expect(x.id).toBe(`career_${i}`);
      expect(d3(x.pos, TRAIL_ARC.centre)).toBeCloseTo(TRAIL_ARC.radius, 6);
    });
    expect(b[0].pos).toEqual(arcPoint(TRAIL_ARC, 0));
    const gaps = gapsOf(b.map((x) => x.pos));
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(15); // a card is BUOY_CARD_R (6) each side
      expect(g).toBeLessThanOrEqual(50);
      expect(g).toBeCloseTo(gaps[0], 6);
      if (n <= 9) expect(g).toBeGreaterThanOrEqual(20);
    }
    expect(15).toBeGreaterThan(2 * BUOY_CARD_R);
  });

  it.each(SIZES)("%i entries: climbs, starts in the opening view, and ends at the arc's end from five entries up", (n) => {
    const b = buildBuoys(jobs(n));
    for (let i = 1; i < b.length; i++) expect(b[i].pos[1]).toBeGreaterThan(b[i - 1].pos[1]);
    expect(STATION_POS[1]).toBeGreaterThan(b[b.length - 1].pos[1]);
    const first = d3(b[0].pos, SPAWN_V);
    expect(first).toBeGreaterThanOrEqual(30);
    expect(first).toBeLessThanOrEqual(45);
    if (n >= 5) {
      const last = d3(b[b.length - 1].pos, STATION_POS);
      expect(last).toBeGreaterThanOrEqual(15);
      expect(last).toBeLessThanOrEqual(25);
    }
  });

  it("gives buoys to the newest twelve of thirteen and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = buildBuoys(jobs(13));
    expect(b).toHaveLength(12);
    expect(b[0].entry.company).toBe("Co 1");
    expect(b[11].entry.company).toBe("Co 12");
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toMatch(/12/);
    warn.mockRestore();
  });

  it("lists every position any supported count can use, and nothing else", () => {
    const all = possibleBuoyPositions();
    for (const n of SIZES) for (const x of buildBuoys(jobs(n))) {
      expect(all.some((p) => d3(p, x.pos) < 1e-9), `${n}: ${x.id}`).toBe(true);
    }
    for (const p of all) expect(d3(p, TRAIL_ARC.centre)).toBeCloseTo(TRAIL_ARC.radius, 6);
  });

  it("keeps every possible buoy position clear of every swept orbit and rock orbit", () => {
    for (const p of possibleBuoyPositions()) {
      expect(landmarkMargin(p, BUOY_CARD_R), `${p.map((v) => v.toFixed(0)).join(",")} vs ${worstRule(p, BUOY_CARD_R)}`).toBeGreaterThan(0);
    }
  }, 60_000);

  it("keeps every possible buoy position clear of the sun, the portal, scenery, rings and shards", () => {
    for (const p of possibleBuoyPositions()) {
      const name = p.map((v) => v.toFixed(0)).join(",");
      expect(d3(p, [SUN_COLLIDER.x, SUN_COLLIDER.y, SUN_COLLIDER.z]), name).toBeGreaterThan(SUN_COLLIDER.r + BUOY_CARD_R + MARGIN);
      expect(d3(p, PORTAL_POS), name).toBeGreaterThan(PORTAL_ZONE_R + BUOY_CARD_R + 40);
      for (const a of ASTEROID_COLLIDERS) expect(d3(p, [a.x, a.y, a.z]), `${a.id} vs ${name}`).toBeGreaterThan(a.r + BUOY_CARD_R + MARGIN);
      RING_GATES.forEach((g, i) => expect(d3(p, g), `gate ${i} vs ${name}`).toBeGreaterThan(RING_RADIUS + BUOY_CARD_R));
      SHARDS.forEach((s, i) => expect(d3(p, s.pos), `shard ${i} vs ${name}`).toBeGreaterThan(BUOY_CARD_R + MARGIN));
    }
  });

  it.each([1, 2, 3, 4])("%i entries: the leg from the last buoy to the station is clear too", (n) => {
    const b = buildBuoys(jobs(n));
    const last = b[b.length - 1].pos;
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const p: Vec3 = [last[0] + (STATION_POS[0] - last[0]) * t, last[1] + (STATION_POS[1] - last[1]) * t, last[2] + (STATION_POS[2] - last[2]) * t];
      expect(landmarkMargin(p, BUOY_CARD_R), `leg ${t} vs ${worstRule(p, BUOY_CARD_R)}`).toBeGreaterThan(0);
    }
  }, 60_000);
});
