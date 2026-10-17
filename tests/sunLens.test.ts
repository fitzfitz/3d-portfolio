import { describe, it, expect } from "vitest";
import { SUN_RADIUS } from "../src/constants";
import { SPAWN } from "../src/data/spawn";
import { CORONA_SIZE } from "../src/components/canvas/sunMaterials";
import { sunApparentRadius, lensScale, LENS_REF_APPARENT_R, coronaLimbFit } from "../src/utils/sunLens";

const FOV = 60; // GlobalCanvas's camera
const BELT_INNER = 40;
const SPAWN_D = Math.hypot(SPAWN.x, SPAWN.y, SPAWN.z);
/** Camera distances from the sun's centre, from just outside the collider to the system edge. */
const DISTANCES = Array.from({ length: 200 }, (_, i) => 25.5 + i * 2);

describe("the sun's lens effects follow its apparent size (L22, L35)", () => {
  it("apparent radius is the true limb, tan(asin(R/d)), in half-screen-heights", () => {
    const d = 115;
    const want = Math.tan(Math.asin(SUN_RADIUS / d)) / Math.tan((FOV * Math.PI) / 360);
    expect(sunApparentRadius(d, FOV)).toBeCloseTo(want, 12);
    expect(sunApparentRadius(50, FOV)).toBeGreaterThan(sunApparentRadius(100, FOV));
  });
  it("stays finite with the camera at or inside the surface", () => {
    for (const d of [SUN_RADIUS, SUN_RADIUS * 0.5, 0]) expect(Number.isFinite(sunApparentRadius(d, FOV))).toBe(true);
  });
  it("spikes and veil keep their screen size for a small disc and grow with a big one", () => {
    expect(lensScale(0.05)).toBe(1);
    expect(lensScale(LENS_REF_APPARENT_R)).toBe(1);
    expect(lensScale(0.36)).toBeCloseTo(3, 12);
  });
  it("from the spawn the disc is bigger than the old reference, so the spikes scale past it", () => {
    const a = sunApparentRadius(SPAWN_D, FOV);
    expect(a).toBeGreaterThan(LENS_REF_APPARENT_R);
    // Spikes reach 0.45 half-heights at scale 1: 3.75 disc radii at the reference size, at every size.
    expect((0.45 * lensScale(a)) / a).toBeCloseTo(0.45 / LENS_REF_APPARENT_R, 9);
  });
});

describe("the corona billboard sits on the limb (L35)", () => {
  const fit = { offset: 0, scale: 1 };
  it("its disc edge lands exactly on the sphere's projected limb, so the halo starts at the limb", () => {
    for (const d of DISTANCES) {
      coronaLimbFit(d, fit);
      const discR = SUN_RADIUS * fit.scale; // uDisc × half-size × scale
      const angle = Math.atan(discR / (d - fit.offset));
      expect(angle, `d=${d}`).toBeCloseTo(Math.asin(SUN_RADIUS / d), 9);
    }
  });
  it("the halo reaches 1.5 limb radii on screen at every distance", () => {
    for (const d of DISTANCES) {
      coronaLimbFit(d, fit);
      // Screen radius goes as the tangent of the angle off the sun's centre.
      const outer = ((CORONA_SIZE / 2) * fit.scale) / (d - fit.offset);
      expect(outer / Math.tan(Math.asin(SUN_RADIUS / d)), `d=${d}`).toBeCloseTo(CORONA_SIZE / 2 / SUN_RADIUS, 9);
    }
  });
  it("at rest the halo ends before the belt's inner edge (r 40) in world terms", () => {
    for (const d of DISTANCES) {
      coronaLimbFit(d, fit);
      const reach = Math.hypot(fit.offset, (CORONA_SIZE / 2) * fit.scale);
      expect(reach, `d=${d}`).toBeLessThanOrEqual(CORONA_SIZE / 2 + 1e-9);
      expect(reach, `d=${d}`).toBeLessThan(BELT_INNER);
    }
  });
  it("stays finite with the camera at or inside the surface", () => {
    for (const d of [SUN_RADIUS, 0]) {
      coronaLimbFit(d, fit);
      expect(Number.isFinite(fit.offset) && Number.isFinite(fit.scale)).toBe(true);
    }
  });
});
