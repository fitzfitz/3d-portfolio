import { describe, it, expect } from "vitest";
import { jumpPoint, nextWaypoint } from "../src/utils/navigation";
import { noseDirection } from "../src/utils/pitchFlight";
import { PROBE_RADIUS, PROBE_JUMP_STANDOFF } from "../src/data/probes";
import { BEAM_RANGE } from "../src/utils/tractorBeam";
import { SHIP_HALF_LENGTH } from "../src/utils/worldCollide";

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

  it("a probe jump parks inside BEAM_RANGE and outside PROBE_RADIUS + ship half-length", () => {
    expect(PROBE_JUMP_STANDOFF).toBeLessThan(BEAM_RANGE);
    expect(PROBE_JUMP_STANDOFF).toBeGreaterThan(PROBE_RADIUS + SHIP_HALF_LENGTH);
    const p = jumpPoint({ x: 0, y: 0, z: 0 }, target, PROBE_JUMP_STANDOFF);
    expect(Math.hypot(p.x - target.x, p.z - target.z)).toBeCloseTo(PROBE_JUMP_STANDOFF);
  });
});

describe("nextWaypoint", () => {
  const bodies = {
    saas: { x: 10, y: 0, z: 0 },
    video: { x: 50, y: 0, z: 0 },
    agent: { x: -200, y: 0, z: 0 },
  };
  const names = ["saas", "video", "agent"];

  it("points at the nearest unvisited body", () => {
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, [], "contact")).toBe("saas");
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas"], "contact")).toBe("video");
  });

  it("points at the fallback destination once every dossier is read", () => {
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas", "video", "agent"], "contact")).toBe("contact");
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas", "video", "agent"], "career")).toBe("career");
  });
});
