import { describe, it, expect } from "vitest";
import { planets, PORTAL_POS, PORTAL_ZONE_R } from "../src/constants";
import { SHARDS } from "../src/data/shards";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../src/data/asteroids";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import { STATION_POS, STATION_RADII, BUOYS, BUOY_CARD_R, type Vec3 } from "../src/data/careerTrail";
import { SHIPYARD_POS, SHIPYARD_RADII, SHIPYARD_BLUE } from "../src/data/shipyard";
import {
  GATE_POS, GATE_RADIUS, GATE_OPENING_R, GATE_SENSE_R, GATE_KEEP_OUT, GATE_NORMAL, GATE_LINES,
} from "../src/data/dormantGate";
import { HAZE_START } from "../src/utils/edgeHaze";
import { d3, closestApproach, beltClearance, MOON_REACH_FACTOR, MARGIN } from "./helpers/clearance";

const SPAWN: Vec3 = [0, 0, 18];
const PLACES: { name: string; pos: Vec3; keepOut: number }[] = [
  { name: "shipyard", pos: SHIPYARD_POS, keepOut: SHIPYARD_RADII.zoneR },
  { name: "gate", pos: GATE_POS, keepOut: GATE_KEEP_OUT },
];

describe("B2 landmark clearance", () => {
  it("never shares space with a planet's swept orbit, its zone or its moons", () => {
    for (const planet of planets) for (const p of PLACES) {
      expect(closestApproach(planet, p.pos), `${planet.name} vs ${p.name}`)
        .toBeGreaterThan(planet.size * MOON_REACH_FACTOR + p.keepOut + MARGIN);
    }
  });
  it("keeps clear of the sun, the portal, the career landmarks and the scenery asteroids", () => {
    for (const p of PLACES) {
      expect(d3(p.pos, [SUN_COLLIDER.x, SUN_COLLIDER.y, SUN_COLLIDER.z]), `sun vs ${p.name}`)
        .toBeGreaterThan(SUN_COLLIDER.r + p.keepOut + MARGIN);
      expect(d3(p.pos, PORTAL_POS), `portal vs ${p.name}`).toBeGreaterThan(PORTAL_ZONE_R + p.keepOut + 40);
      expect(d3(p.pos, STATION_POS), `station vs ${p.name}`).toBeGreaterThan(STATION_RADII.zoneR + p.keepOut + 40);
      for (const b of BUOYS) expect(d3(p.pos, b.pos), `${b.id} vs ${p.name}`).toBeGreaterThan(BUOY_CARD_R + p.keepOut + MARGIN);
      for (const a of ASTEROID_COLLIDERS) {
        expect(d3(p.pos, [a.x, a.y, a.z]), `${a.id} vs ${p.name}`).toBeGreaterThan(a.r + p.keepOut + MARGIN);
      }
    }
  });
  it("keeps clear of every time-trial ring and every data shard", () => {
    for (const p of PLACES) {
      RING_GATES.forEach((g, i) => expect(d3(p.pos, g), `ring ${i} vs ${p.name}`).toBeGreaterThan(RING_RADIUS + p.keepOut + MARGIN));
      SHARDS.forEach((s, i) => expect(d3(p.pos, s.pos), `shard ${i} vs ${p.name}`).toBeGreaterThan(p.keepOut + MARGIN));
    }
  });
  it("is not buried in the asteroid belt or the polar halo", () => {
    for (const p of PLACES) {
      expect(beltClearance(p.pos, 0.436, 40, 70, 2.5), `belt vs ${p.name}`).toBeGreaterThan(p.keepOut);
      expect(beltClearance(p.pos, 1.31, 80, 95, 4.5), `halo vs ${p.name}`).toBeGreaterThan(p.keepOut);
    }
  });
  it("keeps the two new landmarks far apart", () => {
    expect(d3(SHIPYARD_POS, GATE_POS)).toBeGreaterThan(GATE_SENSE_R + SHIPYARD_RADII.zoneR);
  });
});

describe("shipyard placement", () => {
  it("sits above the plane, inside the innermost orbit, a short trip from spawn", () => {
    expect(SHIPYARD_POS[1]).toBeGreaterThan(0);
    expect(Math.hypot(...SHIPYARD_POS)).toBeLessThan(Math.min(...planets.map((p) => p.orbit.radius)) - 20);
    expect(d3(SHIPYARD_POS, SPAWN)).toBeLessThan(100);
  });
  it("docks like the career station (same model radius budget) and is steel blue", () => {
    expect(SHIPYARD_RADII).toEqual({ zoneR: 8.5, lockR: 7.2, retainR: 13, orbitR: 10, jumpR: 6.7 });
    expect(SHIPYARD_BLUE).toBe("#5b8cff");
  });
});

describe("dormant gate placement", () => {
  it("stays out of the edge haze, frame included", () => {
    for (const v of GATE_POS) expect(Math.abs(v) + GATE_RADIUS).toBeLessThan(HAZE_START);
  });
  it("lies beyond the outermost planet orbit", () => {
    expect(Math.hypot(...GATE_POS)).toBeGreaterThan(Math.max(...planets.map((p) => p.orbit.radius)));
  });
  it("faces the sun through an opening narrower than the frame", () => {
    expect(Math.hypot(...GATE_NORMAL)).toBeCloseTo(1, 10);
    const towardSun = GATE_POS.map((v) => -v / Math.hypot(...GATE_POS));
    GATE_NORMAL.forEach((v, i) => expect(v).toBeCloseTo(towardSun[i], 10));
    expect(GATE_OPENING_R).toBeLessThan(GATE_RADIUS - 4);
    expect(GATE_KEEP_OUT).toBeGreaterThan(GATE_RADIUS);
  });
  it("carries the spec's radio copy", () => {
    expect(GATE_LINES.approach).toBe("CONTROL // THAT STRUCTURE ISN'T ONE OF OURS. NO RECORD OF IT ANYWHERE.");
    expect(GATE_LINES.pass).toBe("CONTROL // YOUR READINGS SPIKED THE MOMENT YOU CROSSED. THEN NOTHING.");
  });
});
