import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AU, SYSTEM_RADIUS } from "../src/constants";
import {
  applyBackdrop, backdropDim, backdropScale, BACKDROP_EXPOSURE_POWER, BACKDROP_NET_MAX, EXPOSURE_LIFT, EXPOSURE_POWER, targetExposure,
} from "../src/utils/sunLight";

const src = (...p: string[]) => readFileSync(join("src", ...p), "utf8");

// The unlit backdrop (the painted sky, the nebula clouds, the distant
// galaxies) is not sunlit, so a longer exposure brightens it. Under full
// adaptation the Milky Way band glared near the edge (Task 13, r 425), so the
// backdrop is toned down by one disclosed factor: the exposure's growth beyond
// a power-1.5 curve, from 1 AU out (inside 1 AU it follows the full power-2
// exposure). The stars are not toned: they may brighten.
describe("the backdrop follows a power-1.5 curve from 1 AU out (L19, L22)", () => {
  it("is the exposure's growth beyond the power-1.5 curve, undone", () => {
    expect(BACKDROP_EXPOSURE_POWER).toBe(1.5);
    // Up to where the net gain reaches BACKDROP_NET_MAX (≈ 148 u).
    for (const d of [AU, 130, 140, 148]) {
      expect(backdropScale(d) * targetExposure(d), `d=${d}`).toBeCloseTo(EXPOSURE_LIFT * (d / AU) ** BACKDROP_EXPOSURE_POWER, 9);
    }
  });
  it("caps the net backdrop gain a little above its 1 AU value, non-decreasing out to the 3,600 u edge", () => {
    // L19: the camera may lift the unlit sky a little, not 5× (spec 2026-10-27-nest-playable §5).
    expect(BACKDROP_NET_MAX).toBe(2.2);
    expect(AU * (BACKDROP_NET_MAX / EXPOSURE_LIFT) ** (1 / BACKDROP_EXPOSURE_POWER)).toBeCloseTo(148.4, 0);
    for (const d of [3.5 * AU, 13 * AU, SYSTEM_RADIUS]) {
      expect(backdropScale(d) * targetExposure(d), `d=${d}`).toBeCloseTo(2.2, 9);
    }
    let prev = 0;
    for (let d = AU; d <= SYSTEM_RADIUS; d += 7) {
      const net = backdropScale(d) * targetExposure(d);
      expect(net, `d=${d}`).toBeLessThanOrEqual(BACKDROP_NET_MAX + 1e-9);
      expect(net, `d=${d}`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = net;
    }
    expect(backdropScale(SYSTEM_RADIUS) * targetExposure(SYSTEM_RADIUS)).toBeCloseTo(BACKDROP_NET_MAX, 9);
  });
  it("only tones down: 1 at and inside 1 AU, and held at the edge's value beyond it", () => {
    expect(backdropScale(AU)).toBe(1);
    expect(backdropScale(60)).toBe(1);
    expect(backdropScale(10)).toBe(1);
    expect(backdropScale(2 * SYSTEM_RADIUS)).toBe(backdropScale(SYSTEM_RADIUS));
  });
  it("inside 1 AU it follows the full exposure, (d / AU)^2 down to the floor, not the 1.5 curve (L19 says so)", () => {
    for (const d of [50, 60, 90]) {
      expect(backdropScale(d) * targetExposure(d), `d=${d}`).toBeCloseTo(EXPOSURE_LIFT * (d / AU) ** EXPOSURE_POWER, 9);
    }
  });
  it("sets the scene's background intensity and the shared factor together", () => {
    const scene = { backgroundIntensity: 1 };
    try {
      applyBackdrop(scene, 300);
      expect(scene.backgroundIntensity).toBeCloseTo(backdropScale(300), 12);
      expect(backdropDim.value).toBeCloseTo(backdropScale(300), 12);
    } finally {
      applyBackdrop(scene, AU);
    }
    expect(backdropDim.value).toBe(1);
  });
  it("is applied every frame and on a camera cut; the nebulae and galaxies read it, the stars do not", () => {
    expect(src("components", "canvas", "GlobalCanvas.tsx")).toMatch(/applyBackdrop\(scene, d\)/);
    expect(src("components", "canvas", "Spaceship.tsx")).toMatch(/if \(cut\) \{[^}]*applyBackdrop\(state\.scene, /s);
    expect(src("components", "canvas", "SpacePlanets.tsx")).toMatch(/mat\.color\.setHSL\([^;]*\)\.multiplyScalar\(backdropDim\.value\)/);
    expect(src("components", "canvas", "DistantGalaxies.tsx")).toMatch(/s\.material\.color\.setScalar\(backdropDim\.value\)/);
    expect(src("components", "canvas", "starLayer.ts")).not.toMatch(/backdropDim/);
  });
});
