import { describe, it, expect } from "vitest";
import { planets, AU } from "../src/constants";
import { ASTEROID_COLLIDERS } from "../src/data/asteroids";
import { SPAWN } from "../src/data/spawn";
import { validateDrop } from "../src/utils/beacons";
import { d3, closestApproach, beltClearance, MOON_REACH_FACTOR, MARGIN } from "./helpers/clearance";

const P = [SPAWN.x, SPAWN.y, SPAWN.z] as const;

describe("spawn at 0.92 AU (F3 revision)", () => {
  it("sits 105.4 from the sun", () => { expect(Math.hypot(SPAWN.x, SPAWN.y, SPAWN.z)).toBeCloseTo(105.4, 1); });
  it("gets about Ruangrapi's sunlight (1.0–1.3x)", () => {
    const r = Math.hypot(SPAWN.x, SPAWN.y, SPAWN.z);
    const k = (AU / r) ** 2;
    expect(k).toBeGreaterThan(1);
    expect(k).toBeLessThan(1.3);
  });
  it.each(planets.map((p) => [p.name, p] as const))("clears %s's swept orbit, moons included, by a wide margin", (_, p) => {
    expect(closestApproach(p, P)).toBeGreaterThan(p.size * MOON_REACH_FACTOR + 8.5 + MARGIN + 40);
  });
  it("is clear of the belt and the halo", () => {
    expect(beltClearance(P, 0.436, 40, 70, 2.5)).toBeGreaterThan(15);
    expect(beltClearance(P, 1.31, 80, 95, 4.5)).toBeGreaterThan(15);
  });
  it("is clear of every scenery asteroid", () => {
    for (const a of ASTEROID_COLLIDERS) expect(d3([a.x, a.y, a.z], P) - a.r).toBeGreaterThan(20);
  });
  it("refuses beacons on the new pad and accepts them 16 away", () => {
    expect(validateDrop({ x: SPAWN.x + 2, y: SPAWN.y, z: SPAWN.z + 2, phrase: 0 }).ok).toBe(false);
    expect(validateDrop({ x: SPAWN.x, y: SPAWN.y, z: SPAWN.z + 16, phrase: 0 }).ok).toBe(true);
  });
});
