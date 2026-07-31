import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FUEL_MAX, FUEL_DRAIN_PER_SEC, FUEL_PER_CRYSTAL, FUEL_LOW, drainFuel, refuel, refuelOutcome } from "../src/utils/fuel";
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

describe("refuelOutcome", () => {
  it("announces a restoration only from a genuinely dry tank", () => {
    expect(refuelOutcome(0)).toBe("restored");
  });

  it("acknowledges a low-but-not-dry pickup without claiming warp came back", () => {
    // Warp was never offline here, so this must NOT be "restored" — the
    // "WARP ONLINE" copy would be stating something untrue.
    expect(refuelOutcome(0.1)).toBe("topped-up");
    expect(refuelOutcome(FUEL_LOW - 0.1)).toBe("topped-up");
  });

  it("is quiet at exactly FUEL_LOW — the boundary comparison is strict", () => {
    expect(refuelOutcome(FUEL_LOW)).toBe("quiet");
  });

  it("is quiet on a healthy tank, so crossing a crystal field cannot stomp the ticker", () => {
    // This is the whole point of the feature: RadioChatter's typeLine
    // interrupts, so a line per pickup would machine-gun the HUD across 40
    // respawning crystals.
    expect(refuelOutcome(50)).toBe("quiet");
    expect(refuelOutcome(FUEL_MAX - 1)).toBe("quiet");
  });

  it("keeps the pre-existing vented case at a full tank", () => {
    expect(refuelOutcome(FUEL_MAX)).toBe("vented");
  });

  it("treats a negative tank as dry rather than falling through to quiet", () => {
    // drainFuel clamps at 0, so this should be unreachable. If it ever does
    // happen, saying something correct beats silently saying nothing.
    expect(refuelOutcome(-1)).toBe("restored");
  });

  it("pins FUEL_LOW at 25, so retuning it is a deliberate act", () => {
    // A tuning pin, like the one-crossing test above: it does not test
    // behaviour, it makes a change to the tuning fail loudly so nobody moves
    // the gauge's amber point by accident.
    //
    // Deliberately does NOT assert anything about FUEL_PER_CRYSTAL. The two
    // are both 25 today by coincidence, not by relationship, and a test
    // asserting them together would manufacture exactly the coupling
    // fuel.ts's comment says must not exist.
    expect(FUEL_LOW).toBe(25);
  });
});

describe("the low threshold has exactly one home", () => {
  it("HUDOverlay reads FUEL_LOW instead of a bare 0.25", () => {
    // Source scan, same convention as tests/identity.test.ts: the gauge's
    // amber point and the pickup's announce point are the same boundary, and
    // a duplicated literal at each site is how they would silently drift
    // apart — the bar going amber at a level where the pickup stayed quiet.
    const src = readFileSync(join("src", "components", "layout", "HUDOverlay.tsx"), "utf8");
    expect(src).toContain("FUEL_LOW");
    expect(src).not.toMatch(/pct < 0\.25/);
  });
});
