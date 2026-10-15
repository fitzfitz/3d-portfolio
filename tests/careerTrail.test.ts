import { describe, it, expect } from "vitest";
import { planets, PORTAL_POS, PORTAL_ZONE_R } from "../src/constants";
import { orbitPosition } from "../src/utils/orbits";
import { career } from "../src/data/career";
import { SHARDS } from "../src/data/shards";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../src/data/asteroids";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import {
  STATION_POS, STATION_RADII, BUOYS, BUOY_CARD_R, TRAIL_ARC, arcThrough, arcPoint, startKey, type Vec3,
} from "../src/data/careerTrail";

/** Spawn pad (Spaceship.tsx SPAWN, beacons.ts SPAWN). */
const SPAWN: Vec3 = [0, 0, 18];
const SAMPLES = 2000;
/**
 * A planet's reach: its farthest moon is fuxx's ice moon, orbiting at 2.1 ×
 * size with radius 0.0625 × size (SpacePlanets.tsx), so 2.2 × size covers
 * the planet, its proximity zone (1.8 ×) and every moon.
 */
const MOON_REACH_FACTOR = 2.2;
const MARGIN = 4;

const d3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Closest approach of a planet's centre, over a full orbit, to a fixed point (as planetClearance.test.ts). */
function closestApproach(planet: (typeof planets)[number], p: readonly number[]): number {
  let min = Infinity;
  const period = (Math.PI * 2) / planet.orbit.angularSpeed;
  for (let k = 0; k < SAMPLES; k++) {
    const q = orbitPosition(planet.orbit, (k / SAMPLES) * period);
    min = Math.min(min, Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]));
  }
  return min;
}

/**
 * Distance above or below a tilted asteroid ring (AsteroidBelt.tsx: tilt about
 * X, ring radius rMin..rMax, rocks within ±halfThickness of its plane), or
 * Infinity when the point is outside the ring's radial band.
 */
function beltClearance(p: readonly number[], tilt: number, rMin: number, rMax: number, halfThickness: number): number {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const ly = c * p[1] + s * p[2];
  const lz = -s * p[1] + c * p[2];
  const r = Math.hypot(p[0], lz);
  return r < rMin - MARGIN || r > rMax + MARGIN ? Infinity : Math.abs(ly) - halfThickness;
}

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
    const first = d3(BUOYS[0].pos, SPAWN);
    const last = d3(BUOYS[BUOYS.length - 1].pos, STATION_POS);
    expect(first).toBeGreaterThanOrEqual(30);
    expect(first).toBeLessThanOrEqual(45);
    expect(last).toBeGreaterThanOrEqual(15);
    expect(last).toBeLessThanOrEqual(25);
  });
  it("puts the station below the orbital plane, as the portal is above it", () => {
    expect(STATION_POS[1]).toBeLessThan(-80);
  });
});

describe("career landmark clearance", () => {
  it("never shares space with a planet's swept orbit, its zone or its moons", () => {
    for (const planet of planets) {
      for (const p of PLACES) {
        expect(closestApproach(planet, p.pos), `${planet.name} vs ${p.name}`)
          .toBeGreaterThan(planet.size * MOON_REACH_FACTOR + p.keepOut + MARGIN);
      }
    }
  });
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
  it("is not buried in the asteroid belt or the polar halo", () => {
    for (const p of PLACES) {
      expect(beltClearance(p.pos, 0.436, 40, 70, 2.5), `belt vs ${p.name}`).toBeGreaterThan(p.keepOut);
      expect(beltClearance(p.pos, 1.31, 80, 95, 4.5), `halo vs ${p.name}`).toBeGreaterThan(p.keepOut);
    }
  });
});
