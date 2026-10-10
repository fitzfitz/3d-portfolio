import { describe, it, expect } from "vitest";
import { jumpPoint, nextWaypoint } from "../src/utils/navigation";
import { noseDirection } from "../src/utils/pitchFlight";
import { planets, LOCK_ENGAGE_FACTOR, ORBIT_RADIUS_FACTOR } from "../src/constants";

describe("jumpPoint", () => {
  const target = { x: 100, y: -20, z: 40 };

  it("parks level with the target, at the standoff, on the ship's side", () => {
    const p = jumpPoint({ x: 0, y: 0, z: 0 }, target, 5);
    expect(p.y).toBe(target.y);
    expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeCloseTo(5);
    // Ship side: closer to the origin ship than the target is.
    expect(Math.hypot(p.x, p.z)).toBeLessThan(Math.hypot(target.x, target.z));
  });

  it("faces the target", () => {
    const p = jumpPoint({ x: 0, y: 0, z: 0 }, target, 5);
    const n = noseDirection(p.yaw, 0);
    const dx = target.x - p.x, dz = target.z - p.z, len = Math.hypot(dx, dz);
    expect(n.x).toBeCloseTo(dx / len);
    expect(n.z).toBeCloseTo(dz / len);
  });

  it("handles a ship directly above the target", () => {
    const p = jumpPoint({ x: 100, y: 80, z: 40 }, target, 5);
    expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeCloseTo(5);
  });

  it("the planet standoff lands inside the lock radius, outside the planet", () => {
    for (const pl of planets) {
      const standoff = pl.size * 1.2;
      expect(standoff).toBeGreaterThan(pl.size);
      expect(standoff).toBeLessThan(pl.size * LOCK_ENGAGE_FACTOR);
      expect(standoff).toBeLessThan(pl.size * ORBIT_RADIUS_FACTOR);
    }
  });
});

describe("nextWaypoint", () => {
  const bodies = {
    saas: { x: 10, y: 0, z: 0 },
    video: { x: 50, y: 0, z: 0 },
    agent: { x: -200, y: 0, z: 0 },
  };
  const names = ["saas", "video", "agent"];

  it("points at the nearest unvisited planet", () => {
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, [])).toBe("saas");
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas"])).toBe("video");
  });

  it("points at the contact portal once every dossier is read", () => {
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas", "video", "agent"])).toBe("contact");
  });
});
