import { describe, it, expect } from "vitest";
import { PORTAL_POS, PORTAL_ZONE_R } from "../src/constants";
import { career } from "../src/data/career";
import { SHARDS } from "../src/data/shards";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../src/data/asteroids";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import {
  STATION_POS, STATION_RADII, BUOYS, BUOY_CARD_R, TRAIL_ARC, arcThrough, arcPoint, startKey, type Vec3,
} from "../src/data/careerTrail";
import { SPAWN } from "../src/data/spawn";
import { PROBES } from "../src/data/probes";
import { headingToward } from "../src/utils/pitchFlight";
import { d3, MARGIN } from "./helpers/clearance";
import { landmarkMargin, worstRule } from "./helpers/solarClearance";

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
