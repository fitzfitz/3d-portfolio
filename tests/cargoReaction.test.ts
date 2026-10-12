import { describe, it, expect } from "vitest";
import {
  cargoSwerveTarget, HailGate,
  CARGO_REACT_RADIUS, CARGO_SWERVE_MAX, CARGO_HAIL_RADIUS, HAIL_COOLDOWN_S,
} from "../src/utils/cargoReaction";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const HEADING = v(0, 0, 1); // the route runs along +z here
const len = (o: { x: number; y: number; z: number }) => Math.hypot(o.x, o.y, o.z);

describe("cargoSwerveTarget", () => {
  it("is zero when the player is beyond the react radius", () => {
    expect(cargoSwerveTarget(v(), v(), HEADING, v(CARGO_REACT_RADIUS + 1, 0, 0))).toEqual(v());
  });
  it("pushes sideways and away from the player, never along the route", () => {
    const o = cargoSwerveTarget(v(), v(), HEADING, v(5, 0, 3)); // player off the +x side, a little ahead
    expect(o.x).toBeLessThan(0);
    expect(o.z).toBeCloseTo(0, 6);
  });
  it("is capped at the swerve max", () => {
    expect(len(cargoSwerveTarget(v(), v(), HEADING, v(0.5, 0, 0)))).toBeCloseTo(CARGO_SWERVE_MAX);
  });
  it("grows as the player closes in", () => {
    const far = cargoSwerveTarget(v(), v(), HEADING, v(25, 0, 0));
    const near = cargoSwerveTarget(v(), v(), HEADING, v(15, 0, 0));
    expect(len(near)).toBeGreaterThan(len(far));
  });
  it("still picks a finite sideways direction when the player is dead ahead on the route", () => {
    const o = cargoSwerveTarget(v(), v(), HEADING, v(0, 0, 5));
    expect([o.x, o.y, o.z].every(Number.isFinite)).toBe(true);
    expect(len(o)).toBeGreaterThan(0);
    expect(o.z).toBeCloseTo(0, 6);
  });
});

describe("HailGate", () => {
  it("hails once per approach", () => {
    const g = new HailGate(1);
    expect(g.update(0, CARGO_HAIL_RADIUS - 1, 0, false)).toBe(true);
    expect(g.update(0, CARGO_HAIL_RADIUS - 1, 100, false)).toBe(false);
  });
  it("re-arms once the player has left the react radius", () => {
    const g = new HailGate(1);
    g.update(0, 5, 0, false);
    g.update(0, CARGO_REACT_RADIUS + 1, 50, false);
    expect(g.update(0, 5, 100, false)).toBe(true);
  });
  it("holds one cooldown across all ships", () => {
    const g = new HailGate(2);
    expect(g.update(0, 5, 0, false)).toBe(true);
    expect(g.update(1, 5, HAIL_COOLDOWN_S - 1, false)).toBe(false);
  });
  it("lets another ship hail after the cooldown", () => {
    const g = new HailGate(2);
    g.update(0, 5, 0, false);
    expect(g.update(1, 5, HAIL_COOLDOWN_S + 1, false)).toBe(true);
  });
  it("stays silent during a running race, and that approach is spent", () => {
    const g = new HailGate(1);
    expect(g.update(0, 5, 0, true)).toBe(false);
    expect(g.update(0, 5, 100, false)).toBe(false);
  });
  it("does not talk over a broadcast that just arrived, and that approach is spent", () => {
    // Review finding: a hail replaced a shard fact or scan report mid-type.
    const g = new HailGate(1);
    expect(g.update(0, 5, 0, false, true)).toBe(false);
    expect(g.update(0, 5, 100, false, false)).toBe(false);
  });
  it("does not hail between the hail radius and the react radius", () => {
    const g = new HailGate(1);
    expect(g.update(0, (CARGO_HAIL_RADIUS + CARGO_REACT_RADIUS) / 2, 0, false)).toBe(false);
  });
});
