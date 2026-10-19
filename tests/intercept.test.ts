import { describe, it, expect } from "vitest";
import { interceptAim } from "../src/utils/intercept";
import { orbitPosition } from "../src/utils/orbits";
import { SPAWN } from "../src/data/spawn";
import { planets, SHIP_MAX_SPEED } from "../src/constants";

// The lock-radius pass went with planet docking (project probes, spec §4.4).
describe("interceptAim", () => {
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
