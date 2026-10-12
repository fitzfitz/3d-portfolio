import { describe, it, expect } from "vitest";
import { edgeDepth, wrapCoord, HazeLineGate, HAZE_START } from "../src/utils/edgeHaze";
import { COSMIC_BOUNDS } from "../src/constants";
import { wrapDelta } from "../src/utils/toroidal";

describe("edgeDepth", () => {
  it("is 0 inside the haze start and 1 at the bounds", () => {
    expect(edgeDepth(0, 0, 0)).toBe(0);
    expect(edgeDepth(HAZE_START, 0, 0)).toBe(0);
    expect(edgeDepth(COSMIC_BOUNDS, 0, 0)).toBe(1);
  });
  it("follows the axis nearest the edge", () => {
    expect(edgeDepth(10, -240, 30)).toBe(edgeDepth(240, 0, 0));
    expect(edgeDepth(0, 0, -232)).toBeGreaterThan(edgeDepth(0, 0, 225));
  });
  it("is symmetric across the seam, so the far side is still deep haze", () => {
    expect(edgeDepth(249, 0, 0)).toBeCloseTo(edgeDepth(-249, 0, 0));
    expect(edgeDepth(-249.6, 0, 0)).toBeGreaterThan(0.9);
  });
});

describe("wrapCoord", () => {
  it("leaves in-bounds values alone", () => {
    expect(wrapCoord(120)).toBe(120);
    expect(wrapCoord(-250)).toBe(-250);
  });
  it("moves by exactly one 500u period, agreeing with wrapDelta", () => {
    expect(wrapCoord(250.4)).toBeCloseTo(-249.6);
    expect(wrapCoord(-251)).toBeCloseTo(249);
    // A point 2u past the seam is the same place the distance helpers think it is.
    expect(wrapDelta(wrapCoord(252), 0, COSMIC_BOUNDS)).toBeCloseTo(wrapDelta(252, 0, COSMIC_BOUNDS));
  });
});

describe("HazeLineGate", () => {
  it("fires once per visit, when depth first passes 0.3", () => {
    const g = new HazeLineGate();
    expect(g.update(0.2, false, false)).toBe(false);
    expect(g.update(0.35, false, false)).toBe(true);
    expect(g.update(0.8, false, false)).toBe(false);
    expect(g.update(0.05, false, false)).toBe(false); // re-arms
    expect(g.update(0.4, false, false)).toBe(true);
  });
  it("holds the line while the radio is busy or a race runs, then fires", () => {
    const g = new HazeLineGate();
    expect(g.update(0.5, true, false)).toBe(false);
    expect(g.update(0.5, false, true)).toBe(false);
    expect(g.update(0.5, false, false)).toBe(true);
  });
});
