import { describe, it, expect } from "vitest";
import { planets, PORTAL_POS, LOCK_ENGAGE_FACTOR, LOCK_RETAIN_FACTOR, ZONE_FACTOR, PORTAL_ZONE_R } from "../src/constants";
import { orbitPosition } from "../src/utils/orbits";
import { SHARDS } from "../src/data/shards";
import { ASTEROID_COLLIDERS } from "../src/data/asteroids";
import { JELLY_PATH } from "../src/data/jellyfishPath";
import { JELLY_RADIUS } from "../src/utils/jellyMood";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import { crystalAvoidPoints, isRejectedSpawn } from "../src/utils/crystalField";

/**
 * Planets sweep their whole orbit, so a fixed object is only safe if it clears
 * every point of that orbit — not just where the planet sits at load. These
 * guard the placements tuned against the planet size, so a size change that
 * swallows a shard or drives a planet through a rock fails here.
 */

const SAMPLES = 2000;

/** Closest approach of a planet's centre, over a full orbit, to a fixed point. */
function closestApproach(planet: (typeof planets)[number], p: readonly number[]): number {
  let min = Infinity;
  const period = (Math.PI * 2) / planet.orbit.angularSpeed;
  for (let k = 0; k < SAMPLES; k++) {
    const q = orbitPosition(planet.orbit, (k / SAMPLES) * period);
    min = Math.min(min, Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]));
  }
  return min;
}


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
      PORTAL_POS,
      { x: 0, y: 200, z: 0 },
    );
    for (const p of planets) {
      const r = p.size * LOCK_RETAIN_FACTOR - 0.5;
      // Off the belt and halo bands, so only the planet keep-out can reject it.
      expect(isRejectedSpawn(at.x + r, at.y, at.z, avoid)).toBe(true);
    }
  });
});
