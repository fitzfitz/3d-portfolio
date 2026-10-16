import { describe, it, expect } from "vitest";
import { interceptAim } from "../src/utils/intercept";
import { orbitPosition } from "../src/utils/orbits";
import { noseDirection } from "../src/utils/pitchFlight";
import { SPAWN } from "../src/data/spawn";
import { planets, SHIP_MAX_SPEED, LOCK_ENGAGE_FACTOR } from "../src/constants";


/** Fly a straight line at cruise speed and report the closest pass to the aimed planet. */
function closestPass(now: number, obstacles: { x: number; y: number; z: number; r: number }[] = []) {
  const aim = interceptAim(SPAWN, planets, now, SHIP_MAX_SPEED, obstacles)!;
  const p = planets.find((q) => q.name === aim.target)!;
  const n = noseDirection(aim.yaw, aim.pitch);
  let best = Infinity;
  for (let t = 0; t < aim.eta * 2; t += 0.05) {
    const b = orbitPosition(p.orbit, now + t);
    const sx = SPAWN.x + n.x * SHIP_MAX_SPEED * t;
    const sy = SPAWN.y + n.y * SHIP_MAX_SPEED * t;
    const sz = SPAWN.z + n.z * SHIP_MAX_SPEED * t;
    best = Math.min(best, Math.hypot(sx - b.x, sy - b.y, sz - b.z));
  }
  return { aim, best, size: p.size };
}

describe("interceptAim", () => {
  it("leads the moving planet so a straight cruise passes inside the lock radius", () => {
    // Regression: aiming at where the planet *is* missed by ~20u, because it
    // drifts ~1.7u/s along its orbit during the ~11s flight.
    for (const now of [0, 15, 60, 200, 400]) {
      const { best, size } = closestPass(now);
      expect(best).toBeLessThan(size * LOCK_ENGAGE_FACTOR);
    }
  });

  it("skips a planet whose straight path runs through an obstacle", () => {
    const free = interceptAim(SPAWN, planets, 0, SHIP_MAX_SPEED, [])!;
    const target = orbitPosition(planets.find((p) => p.name === free.target)!.orbit, free.eta);
    // A large rock parked halfway along that path.
    const rock = { x: (SPAWN.x + target.x) / 2, y: (SPAWN.y + target.y) / 2, z: (SPAWN.z + target.z) / 2, r: 6 };
    const blocked = interceptAim(SPAWN, planets, 0, SHIP_MAX_SPEED, [rock])!;
    expect(blocked.target).not.toBe(free.target);
  });

  it("without lead (frozen orbits) aims at the current position", () => {
    const aim = interceptAim(SPAWN, planets, 0, SHIP_MAX_SPEED, [], false)!;
    const b = orbitPosition(planets.find((p) => p.name === aim.target)!.orbit, 0);
    expect(aim.yaw).toBeCloseTo(Math.atan2(b.x - SPAWN.x, b.z - SPAWN.z));
  });
});
