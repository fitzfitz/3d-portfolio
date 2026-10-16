import { describe, it, expect } from "vitest";
import { glareLevels } from "../src/utils/sunGlare";

describe("glareLevels (L21: no beams in vacuum; L22: lens glare is real)", () => {
  it("is zero behind the camera or when the sun is fully covered", () => {
    expect(glareLevels(0, 0, false, 1, 0)).toEqual({ spikes: 0, veil: 0 });
    expect(glareLevels(0, 0, true, 0, 0)).toEqual({ spikes: 0, veil: 0 });
  });
  it("veiling glare is strongest looking straight at the sun and gone by the screen edge", () => {
    const c = glareLevels(0, 0, true, 1, 0).veil, mid = glareLevels(0.6, 0, true, 1, 0).veil;
    expect(c).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
    expect(glareLevels(1.0, 0, true, 1, 0).veil).toBe(0);
  });
  it("diffraction spikes stay visible toward the edge but not past it", () => {
    expect(glareLevels(1.0, 0, true, 1, 0).spikes).toBeGreaterThan(0);
    expect(glareLevels(1.7, 0, true, 1, 0).spikes).toBe(0);
  });
  it("scales linearly with how much of the sun is uncovered", () => {
    const full = glareLevels(0.2, 0.1, true, 1, 0), half = glareLevels(0.2, 0.1, true, 0.5, 0);
    expect(half.spikes).toBeCloseTo(full.spikes / 2, 9);
    expect(half.veil).toBeCloseTo(full.veil / 2, 9);
  });
  it("a solar flare brightens it by at most 1.5x", () => {
    const calm = glareLevels(0, 0, true, 1, 0), flare = glareLevels(0, 0, true, 1, 1);
    expect(flare.spikes / calm.spikes).toBeCloseTo(1.5, 9);
    expect(glareLevels(0, 0, true, 1, 5).spikes / calm.spikes).toBeCloseTo(1.5, 9);
  });
});
