import { describe, it, expect } from "vitest";
import { planets, PORTAL_POS, LOCK_ENGAGE_FACTOR, LOCK_RETAIN_FACTOR, ZONE_FACTOR, PORTAL_ZONE_R } from "../src/constants";
import { SHARDS } from "../src/data/shards";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../src/data/asteroids";
import { JELLY_PATH } from "../src/data/jellyfishPath";
import { JELLY_RADIUS } from "../src/utils/jellyMood";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import { crystalAvoidPoints, isRejectedSpawn, CRYSTAL_PICKUP_RADIUS } from "../src/utils/crystalField";
import { PROBES, PROBE_RADIUS } from "../src/data/probes";
import { PLANETS_AND_WORLDS } from "../src/data/worlds";
import { DESTINATIONS } from "../src/data/destinations";
import { GATE_POS, GATE_KEEP_OUT } from "../src/data/dormantGate";
import { BUOYS, BUOY_CARD_R } from "../src/data/careerTrail";
import { beltClearance, closestApproach, MOON_REACH_FACTOR, d3 } from "./helpers/clearance";

/**
 * Planets sweep their whole orbit, so a fixed object is only safe if it clears
 * every point of that orbit — not just where the planet sits at load. These
 * guard the placements tuned against the planet size, so a size change that
 * swallows a shard or drives a planet through a rock fails here.
 */

describe("planet clearance along the full orbit", () => {
  it("never engulfs a shard or pulls its pickup into orbit lock", () => {
    for (const planet of planets) {
      SHARDS.forEach((s, i) => {
        expect(closestApproach(planet, s.pos), `${planet.name} vs shard ${i}`)
          .toBeGreaterThan(planet.size * LOCK_RETAIN_FACTOR);
      });
    }
  });

  it("never passes through a scenery asteroid", () => {
    for (const planet of planets) {
      for (const a of ASTEROID_COLLIDERS) {
        expect(closestApproach(planet, [a.x, a.y, a.z]), `${planet.name} vs ${a.id}`)
          .toBeGreaterThan(planet.size + a.r + 2);
      }
    }
  });

  it("never shares space with the jellyfish's swim path", () => {
    for (const planet of planets) {
      for (let i = 0; i < 400; i++) {
        const v = JELLY_PATH.getPointAt(i / 400);
        expect(closestApproach(planet, [v.x, v.y, v.z]), `${planet.name} vs jelly t=${i / 400}`)
          .toBeGreaterThan(planet.size + JELLY_RADIUS + 2);
      }
    }
  });

  it("never drifts close enough that flying a time-trial ring engages orbit lock", () => {
    for (const planet of planets) {
      RING_GATES.forEach((g, i) => {
        expect(closestApproach(planet, g), `${planet.name} vs gate ${i}`)
          .toBeGreaterThan(planet.size * LOCK_ENGAGE_FACTOR + RING_RADIUS + 2);
      });
    }
  });

  it("keeps each planet's proximity zone clear of the portal's", () => {
    for (const planet of planets) {
      expect(closestApproach(planet, PORTAL_POS))
        .toBeGreaterThan(planet.size * ZONE_FACTOR + PORTAL_ZONE_R);
    }
  });
});

describe("crystal spawns near planets", () => {
  it("rejects any spot inside a planet's lock-retain radius", () => {
    const at = { x: 100, y: 0, z: 0 };
    const avoid = crystalAvoidPoints(
      planets.map((p) => ({ ...at, size: p.size })),
      [PORTAL_POS],
      { x: 0, y: 200, z: 0 },
    );
    for (const p of planets) {
      const r = p.size * LOCK_RETAIN_FACTOR - 0.5;
      // Off the belt and halo bands, so only the planet keep-out can reject it.
      expect(isRejectedSpawn(at.x + r, at.y, at.z, avoid)).toBe(true);
    }
  });
});

describe("project probes clear everything they could touch", () => {
  const MARGIN = 4;
  const spots = PROBES.flatMap((p) => [
    { name: `${p.id} home`, pos: p.home },
    ...p.remote.map((r, i) => ({ name: `${p.id} remote ${i + 1}`, pos: r })),
  ]);

  it("clears every planet's and world's whole orbit tube", () => {
    for (const s of spots) {
      for (const b of PLANETS_AND_WORLDS) {
        // A planet's reach covers its moons (MOON_REACH_FACTOR); a world's ring reach is already in b.reach.
        const reach = Math.max(b.size * MOON_REACH_FACTOR, b.reach);
        expect(closestApproach(b, s.pos), `${s.name} vs ${b.key}`).toBeGreaterThan(reach + PROBE_RADIUS + MARGIN);
      }
    }
  });

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
