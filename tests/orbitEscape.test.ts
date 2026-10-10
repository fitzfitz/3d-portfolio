import { describe, it, expect } from "vitest";
import { escapePosition } from "../src/utils/orbitEscape";
import { LOCK_ENGAGE_FACTOR, ZONE_FACTOR, planets } from "../src/constants";

describe("escapePosition", () => {
  it("places the ship on the escape radius, along the centre->ship direction", () => {
    const p = escapePosition({ x: 3, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }, 10);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(10);
    expect(p.x / p.z).toBeCloseTo(3 / 4);
  });

  it("never pulls a ship that is already further out back in", () => {
    const p = escapePosition({ x: 0, y: 20, z: 0 }, { x: 0, y: 0, z: 0 }, 10);
    expect(p).toEqual({ x: 0, y: 20, z: 0 });
  });

  it("picks a direction when the ship sits exactly on the centre", () => {
    const p = escapePosition({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, 5);
    expect(Math.hypot(p.x - 1, p.y - 1, p.z - 1)).toBeCloseTo(5);
  });

  it("the planet escape radius clears both the lock and the proximity zone", () => {
    // Regression: the old fixed 2.8u push left the ship inside the 6.24u lock
    // radius, so a planet drifting toward it re-locked once cooldown ended.
    for (const p of planets) {
      const r = p.size * ZONE_FACTOR * 1.15;
      expect(r).toBeGreaterThan(p.size * LOCK_ENGAGE_FACTOR);
      expect(r).toBeGreaterThan(p.size * ZONE_FACTOR);
    }
  });
});
