import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AU, SYSTEM_RADIUS } from "../src/constants";
import { AMBIENT_BASE, applyFill, fillLight, fillScale, irradianceVsAU } from "../src/utils/sunLight";

describe("the fill falls off with the sunlight (L19)", () => {
  it("is full at 1 AU and a quarter at 2 AU", () => {
    expect(fillScale(AU)).toBe(1);
    expect(fillScale(2 * AU)).toBeCloseTo(0.25, 12);
    expect(fillScale(SYSTEM_RADIUS)).toBeCloseTo(irradianceVsAU(SYSTEM_RADIUS), 12);
  });
  it("is clamped to 1 inside 1 AU", () => {
    expect(fillScale(50)).toBe(1);
    expect(fillScale(1)).toBe(1);
  });
  it("sets the ambient light and the scene's environment intensity together", () => {
    const ambient = { intensity: AMBIENT_BASE };
    const scene = { environmentIntensity: 1 };
    fillLight.ambient = ambient;
    try {
      applyFill(scene, 2 * AU);
      expect(ambient.intensity).toBeCloseTo(AMBIENT_BASE * 0.25, 12);
      expect(scene.environmentIntensity).toBeCloseTo(0.25, 12);
      applyFill(scene, 50);
      expect(ambient.intensity).toBe(AMBIENT_BASE);
      expect(scene.environmentIntensity).toBe(1);
      fillLight.ambient = null;
      applyFill(scene, 2 * AU); // no ambient registered: the scene still follows
      expect(scene.environmentIntensity).toBeCloseTo(0.25, 12);
    } finally {
      fillLight.ambient = null;
    }
  });
  it("the ambient keeps its 0.15 base, applied every frame and on a camera cut", () => {
    expect(AMBIENT_BASE).toBe(0.15);
    const canvas = readFileSync(join("src", "components", "canvas", "GlobalCanvas.tsx"), "utf8");
    expect(canvas).toMatch(/<ambientLight ref=\{registerFillAmbient\} intensity=\{AMBIENT_BASE\} \/>/);
    expect(canvas).toMatch(/applyFill\(scene, d\)/);
    const ship = readFileSync(join("src", "components", "canvas", "Spaceship.tsx"), "utf8");
    expect(ship).toMatch(/if \(cut\) \{[^}]*cutExposure\([^}]*applyFill\(state\.scene, /s);
  });
});
