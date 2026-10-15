import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { MOON_TINTS } from "../src/data/moonTints";

const hsl = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 });

// Hues of the original, fully saturated tints (one per moon), so each moon
// still leans toward its planet's colour.
const ORIGINAL_HUE: Record<keyof typeof MOON_TINTS, number> = {
  ruangrapiRock: 0.404, // #8fffc9
  portfolioIce: 0.548, // #9be8ff
  portfolioRock: 0.548, // #9be8ff
  fuxxVolcanic: 0.759, // #e3b8ff
  fuxxIce: 0.727, // #caa2ff
};

describe("MOON_TINTS", () => {
  it("keeps every moon at or below 25% saturation, so none reads as a planet", () => {
    for (const [k, hex] of Object.entries(MOON_TINTS)) expect(hsl(hex).s, k).toBeLessThanOrEqual(0.25);
  });

  it("keeps each moon's hue family", () => {
    for (const [k, hex] of Object.entries(MOON_TINTS)) {
      expect(Math.abs(hsl(hex).h - ORIGINAL_HUE[k as keyof typeof MOON_TINTS]), k).toBeLessThan(0.02);
    }
  });
});
