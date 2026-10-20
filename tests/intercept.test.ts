import { describe, it, expect } from "vitest";
import { interceptAim, type InterceptTarget } from "../src/utils/intercept";
import { bodyPositionAt } from "../src/utils/bodyPositions";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { SPAWN } from "../src/data/spawn";
import { SHIP_MAX_SPEED } from "../src/constants";

/** The bodies as moving targets, on the orrery clock. */
const targets: InterceptTarget[] = SOLAR_BODIES.map((b) => ({ name: b.id, positionAt: (t, out) => bodyPositionAt(b, t, out) }));
const at = (name: string, t: number) => targets.find((p) => p.name === name)!.positionAt(t, { x: 0, y: 0, z: 0 });

// The lock-radius pass went with planet docking (project probes, spec §4.4).
describe("interceptAim", () => {
  it("skips a body whose straight path runs through an obstacle", () => {
    const free = interceptAim(SPAWN, targets, 0, SHIP_MAX_SPEED, [])!;
    const target = at(free.target, free.eta);
    // A large rock parked halfway along that path.
    const rock = { x: (SPAWN.x + target.x) / 2, y: (SPAWN.y + target.y) / 2, z: (SPAWN.z + target.z) / 2, r: 6 };
    const blocked = interceptAim(SPAWN, targets, 0, SHIP_MAX_SPEED, [rock])!;
    expect(blocked.target).not.toBe(free.target);
  });

  it("without lead (frozen orbits) aims at the current position", () => {
    const aim = interceptAim(SPAWN, targets, 0, SHIP_MAX_SPEED, [], false)!;
    const b = at(aim.target, 0);
    expect(aim.yaw).toBeCloseTo(Math.atan2(b.x - SPAWN.x, b.z - SPAWN.z));
  });

  it("with lead aims where the body will be on arrival", () => {
    const aim = interceptAim(SPAWN, targets, 0, SHIP_MAX_SPEED, [])!;
    const b = at(aim.target, aim.eta);
    expect(aim.yaw).toBeCloseTo(Math.atan2(b.x - SPAWN.x, b.z - SPAWN.z), 2);
  });
});
