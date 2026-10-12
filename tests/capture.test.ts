import { describe, it, expect } from "vitest";
import { canCapture, CAPTURE_SPEED, CAPTURE_SURFACE_MARGIN } from "../src/utils/capture";
import { LOCK_ENGAGE_FACTOR } from "../src/constants";

const size = 16;
const engage = size * LOCK_ENGAGE_FACTOR; // 20.8

describe("canCapture", () => {
  it("never captures outside the engage radius", () => {
    expect(canCapture(engage + 0.01, size, 0)).toBe(false);
  });
  it("captures a slow approach anywhere inside the engage radius", () => {
    expect(canCapture(engage - 0.01, size, CAPTURE_SPEED - 0.01)).toBe(true);
  });
  it("lets a fast pass skim without capture", () => {
    expect(canCapture(19, size, CAPTURE_SPEED)).toBe(false);
  });
  it("always captures within the surface safety net, at any speed", () => {
    expect(canCapture(size + CAPTURE_SURFACE_MARGIN - 0.01, size, 39)).toBe(true);
  });
  it("docks outside the planet at 20 fps", () => {
    // Warp at 39 u/s, dt clamped at 0.05: 1.95u per step. Walk straight in
    // from 25u and take the first captured step: it must be outside the planet.
    let r = 25;
    while (!canCapture(r, size, 39)) r -= 39 * 0.05;
    expect(r).toBeGreaterThan(size);
  });
});
