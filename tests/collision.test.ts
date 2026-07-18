import { describe, it, expect } from "vitest";
import { resolveCollision } from "../src/utils/collision";

describe("resolveCollision", () => {
  it("returns null when outside the radius", () => {
    expect(resolveCollision(10, 0, 0, -1, 0, 0, 0, 0, 0, 5)).toBeNull();
  });
  it("reflects and damps a head-on hit, pushing out of penetration", () => {
    const r = resolveCollision(4.5, 0, 0, -10, 0, 0, 0, 0, 0, 5);
    expect(r).not.toBeNull();
    expect(r!.vx).toBeCloseTo(4.5); // reflected (+x) and damped x0.45
    expect(r!.px).toBeCloseTo(5.05); // pushed to radius + 0.05
  });
  it("leaves tangential velocity direction intact (graze)", () => {
    const r = resolveCollision(4.9, 0, 0, 0, 0, 8, 0, 0, 0, 5);
    expect(r).not.toBeNull();
    expect(r!.vz).toBeCloseTo(8 * 0.45); // no normal component to flip
    expect(r!.vx).toBeCloseTo(0);
  });
  it("handles the dead-center degenerate case without NaN", () => {
    const r = resolveCollision(0, 0, 0, 1, 0, 0, 0, 0, 0, 5);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.px)).toBe(true);
  });
});
