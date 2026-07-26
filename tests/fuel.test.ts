import { describe, it, expect } from "vitest";
import { FUEL_MAX, FUEL_DRAIN_PER_SEC, FUEL_PER_CRYSTAL, drainFuel, refuel } from "../src/utils/fuel";
import { SHIP_WARP_SPEED, COSMIC_BOUNDS } from "../src/constants";

describe("drainFuel", () => {
  it("drains at the configured rate, scaled by dt", () => {
    expect(drainFuel(100, 1)).toBeCloseTo(100 - FUEL_DRAIN_PER_SEC);
    expect(drainFuel(100, 0.5)).toBeCloseTo(100 - FUEL_DRAIN_PER_SEC / 2);
  });

  it("clamps at zero rather than going negative", () => {
    expect(drainFuel(2, 1)).toBe(0);
    // A tab-switch dt spike must not produce a negative tank.
    expect(drainFuel(100, 999)).toBe(0);
  });

  it("is a no-op at dt zero", () => {
    expect(drainFuel(50, 0)).toBe(50);
  });

  it("gives one full crossing of the map on a full tank", () => {
    // The design's central tuning claim: FUEL_MAX / drain = seconds of warp,
    // times warp speed should be about the width of the world.
    //
    // Both sides read the real constants rather than literals, so retuning
    // SHIP_WARP_SPEED or COSMIC_BOUNDS moves the assertion with them instead of
    // leaving a stale 39 here that would keep passing while the intent broke.
    const seconds = FUEL_MAX / FUEL_DRAIN_PER_SEC;
    const reach = seconds * SHIP_WARP_SPEED; // 12.5s x 39 u/s = 487.5 units
    const crossing = COSMIC_BOUNDS * 2; // 500 units, edge to edge
    expect(reach).toBeGreaterThan(crossing * 0.9);
    expect(reach).toBeLessThan(crossing * 1.1);
  });
});

describe("refuel", () => {
  it("adds one crystal's worth", () => {
    expect(refuel(0)).toBe(FUEL_PER_CRYSTAL);
    expect(refuel(50)).toBe(50 + FUEL_PER_CRYSTAL);
  });

  it("clamps at FUEL_MAX rather than overfilling", () => {
    expect(refuel(FUEL_MAX)).toBe(FUEL_MAX);
    expect(refuel(FUEL_MAX - 1)).toBe(FUEL_MAX);
  });

  it("takes four crystals to fill an empty tank", () => {
    let f = 0;
    for (let i = 0; i < 4; i++) f = refuel(f);
    expect(f).toBe(FUEL_MAX);
  });
});
