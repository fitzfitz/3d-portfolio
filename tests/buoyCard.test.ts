import { describe, it, expect } from "vitest";
import { activeBuoy, buoyIndex, BUOY_CARD_EXIT_R, BUOY_SCAN_HOLD_S } from "../src/utils/buoyCard";
import { BUOY_CARD_R, BUOY_POSITIONS, BUOYS } from "../src/data/careerTrail";

const B = [[0, 0, 0], [40, 0, 0], [80, 0, 0]] as const;
const at = (x: number) => ({ x, y: 0, z: 0 });

describe("activeBuoy", () => {
  it("shows a buoy's card inside its card radius, and none between buoys", () => {
    expect(activeBuoy(at(40 + BUOY_CARD_R - 0.1), B, null, null, 0)).toBe(1);
    expect(activeBuoy(at(20), B, null, null, 0)).toBeNull();
  });

  it("keeps a shown card until the wider exit radius, so hovering on the edge never flickers", () => {
    let prev: number | null = null;
    const seen = [5.9, 6.1, 5.95, 6.4, 7.0, 6.2, 7.4].map((x) => (prev = activeBuoy(at(x), B, prev, null, 0)));
    expect(seen).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(activeBuoy(at(BUOY_CARD_EXIT_R + 0.1), B, 0, null, 0)).toBeNull();
  });

  it("does not open a card from the exit band", () => {
    expect(activeBuoy(at(7.0), B, null, null, 0)).toBeNull();
  });

  it("holds a scanned buoy's card from anywhere until the hold runs out", () => {
    const scan = { index: 2, until: 10 };
    expect(activeBuoy(at(20), B, null, scan, 9.9)).toBe(2);
    expect(activeBuoy(at(20), B, 2, scan, 10.1)).toBeNull();
    expect(BUOY_SCAN_HOLD_S).toBeGreaterThanOrEqual(3);
  });

  it("lets a buoy you fly up to replace a held scan", () => {
    expect(activeBuoy(at(41), B, null, { index: 2, until: 10 }, 5)).toBe(1);
  });

  it("finds each of the trail's real buoys", () => {
    BUOY_POSITIONS.forEach((p, i) => {
      expect(activeBuoy({ x: p[0], y: p[1] + 1, z: p[2] }, BUOY_POSITIONS, null, null, 0)).toBe(i);
    });
  });
});

describe("buoyIndex", () => {
  it("reads career_<n> ids of real buoys, and nothing else", () => {
    expect(buoyIndex("career_3")).toBe(3);
    expect(buoyIndex("career")).toBe(-1);
    expect(buoyIndex("asteroid_3")).toBe(-1);
    expect(buoyIndex(`career_${BUOYS.length}`)).toBe(-1);
  });
});
