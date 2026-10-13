import { describe, it, expect } from "vitest";
import { PLUME_COLORS, hasPlumeColour, sparkBase } from "../src/data/plumeColors";
import { LOGBOOK } from "../src/utils/logbook";

describe("PLUME_COLORS", () => {
  it("has stock and a colour for every badge, with valid unique hexes", () => {
    expect(PLUME_COLORS.stock.hex).toBe("#00d9ff");
    const badges = LOGBOOK.filter((e) => e.section === "badge").map((e) => e.id);
    for (const id of badges) expect(hasPlumeColour(id), id).toBe(true);
    const hexes = Object.values(PLUME_COLORS).map((c) => c.hex);
    for (const h of hexes) expect(h).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
  it("knows nothing about essentials or unknown ids", () => {
    expect(hasPlumeColour("contact")).toBe(false);
    expect(hasPlumeColour("nope")).toBe(false);
  });
});

describe("sparkBase", () => {
  it("normalises so the brightest channel is 1", () => {
    expect(sparkBase("#ff8000", [0, 0, 0])).toEqual([1, 128 / 255, 0]);
    const [r, g, b] = sparkBase("#00d9ff", [0, 0, 0]);
    expect(Math.max(r, g, b)).toBe(1);
  });
});
