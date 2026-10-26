import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FUEL_MAX, FUEL_DRAIN_PER_SEC, FUEL_REGEN_PER_SEC, FUEL_LOW, drainFuel, regenFuel, stepFuel } from "../src/utils/fuel";
import { SHIP_WARP_SPEED, SYSTEM_RADIUS } from "../src/constants";

/** The inner system's radius: the old playable edge, where visitors spend their time. */
const INNER_SYSTEM_RADIUS = 480;

describe("drainFuel", () => {
  it("drains at the configured rate, scaled by dt", () => {
    expect(drainFuel(100, 1)).toBeCloseTo(100 - FUEL_DRAIN_PER_SEC);
    expect(drainFuel(100, 0.5)).toBeCloseTo(100 - FUEL_DRAIN_PER_SEC / 2);
  });

  it("clamps at zero rather than going negative", () => {
    expect(drainFuel(1, 1)).toBe(0);
    // A tab-switch dt spike must not produce a negative tank.
    expect(drainFuel(100, 999)).toBe(0);
  });

  it("is a no-op at dt zero", () => {
    expect(drainFuel(50, 0)).toBe(50);
  });

  it("lasts five times the original 12.5 s of warp: 62.5 s, about 2,400 units", () => {
    // 2026-10-17: the owner asked for 5x the endurance (the tank drained too
    // fast at 8/s). The old tuning claim was "one crossing of the map per tank".
    const seconds = FUEL_MAX / FUEL_DRAIN_PER_SEC;
    expect(seconds).toBeCloseTo(5 * 12.5, 9);
    expect(seconds * SHIP_WARP_SPEED).toBeCloseTo(2437.5, 6);
    // More than two and a half diameters of the inner system (the old 480
    // edge). The 3,600 u system is Task 10's long-range cruise: warp grows
    // with free space there, the drain does not.
    expect(seconds * SHIP_WARP_SPEED).toBeGreaterThan(5 * INNER_SYSTEM_RADIUS);
    expect(SYSTEM_RADIUS).toBeGreaterThan(INNER_SYSTEM_RADIUS);
  });
});

describe("FUEL_LOW", () => {
  it("pins FUEL_LOW at 25, so retuning it is a deliberate act", () => {
    // A tuning pin, like the one-crossing test above: it does not test
    // behaviour, it makes a change to the tuning fail loudly so nobody moves
    // the gauge's amber point by accident.
    expect(FUEL_LOW).toBe(25);
  });
});

describe("the low threshold has exactly one home", () => {
  it("HUDOverlay reads FUEL_LOW instead of a bare 0.25", () => {
    // Source scan, same convention as tests/identity.test.ts: the gauge's
    // amber point lives in fuel.ts, and a bare literal here is how the two
    // would silently drift apart.
    const src = readFileSync(join("src", "components", "layout", "HUDOverlay.tsx"), "utf8");
    expect(src).toContain("FUEL_LOW");
    // Tightened from /pct < 0\.25/, which only caught that exact spelling —
    // `pct<0.25` or `pct < .25` would have slipped past. `/0\.25/` catches any
    // reintroduction of the bare literal regardless of surrounding spelling.
    // Verified safe: HUDOverlay.tsx contains no other "0.25" today.
    expect(src).not.toMatch(/0\.25/);
  });
});

describe("the dry-tank line", () => {
  // Source scan: the line is sent from a HUDOverlay effect this unit suite
  // does not mount. The fuel e2e probe reads it off the live store.
  const src = readFileSync(join("src", "components", "layout", "HUDOverlay.tsx"), "utf8");

  it("points at the drive's own refill, now that there are no crystals to collect", () => {
    expect(src).toContain("WARP CORE DRY // RELEASE WARP TO RECHARGE — THRUSTERS STILL NOMINAL");
    expect(src).not.toMatch(/CRYSTAL/);
  });
});

describe("auto-refill", () => {
  it("fills an empty tank in 20 seconds", () => {
    expect(FUEL_MAX / FUEL_REGEN_PER_SEC).toBeCloseTo(20, 9);
    expect(regenFuel(0, 20)).toBe(FUEL_MAX);
    expect(regenFuel(0, 10)).toBeCloseTo(FUEL_MAX / 2, 9);
  });
  it("clamps at a full tank", () => {
    expect(regenFuel(99, 5)).toBe(FUEL_MAX);
    expect(regenFuel(FUEL_MAX, 1)).toBe(FUEL_MAX);
  });
});

describe("stepFuel", () => {
  it("drains while warp is running", () => {
    expect(stepFuel(50, 1, true, true)).toBeCloseTo(50 - FUEL_DRAIN_PER_SEC, 9);
  });
  it("refills only while the pilot is not holding warp", () => {
    expect(stepFuel(50, 1, false, false)).toBeCloseTo(50 + FUEL_REGEN_PER_SEC, 9);
  });
  it("holding warp on an empty tank neither warps nor refills, so warp cannot flicker on and off", () => {
    expect(stepFuel(0, 1, true, false)).toBe(0);
  });
  it("holding warp while it is briefly suppressed does not refill either", () => {
    expect(stepFuel(40, 1, true, false)).toBe(40);
  });
});
