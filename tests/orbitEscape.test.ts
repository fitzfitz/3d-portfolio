import { describe, it, expect } from "vitest";
import { escapePosition } from "../src/utils/orbitEscape";
import { DESTINATIONS, escapeR } from "../src/data/destinations";

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

  // Planets no longer dock (spec §4.4); the escape push is the destinations' alone.
  it("a destination's escape radius clears both its lock and its proximity zone", () => {
    for (const d of DESTINATIONS) {
      expect(escapeR(d), d.id).toBeGreaterThan(d.lockR);
      expect(escapeR(d), d.id).toBeGreaterThan(d.zoneR);
    }
  });
});
