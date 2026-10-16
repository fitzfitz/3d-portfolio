import { describe, it, expect } from "vitest";
import { exposureCompensation } from "../src/utils/sunLight";
import { makeGuideLineMaterial, makePlanetRingMaterial } from "../src/components/canvas/guideLine";
import { makeSunSurfaceMaterial, makeSunCoronaMaterial } from "../src/components/canvas/sunMaterials";

// ExposureDriver writes exposureCompensation.value once a frame; a material
// holding a copy (a clone, a spread) would silently stop following it.
describe("exposure compensation is one shared uniform object (F3)", () => {
  it("the instrument overlays and the sun's core and corona hold the shared object itself", () => {
    const mats = [
      makeGuideLineMaterial({ color: "#fff", opacity: 0.5, dashes: 0, fadeIn: [0, 1] }),
      makeSunSurfaceMaterial(),
      makeSunCoronaMaterial(0.3),
    ];
    for (const m of mats) expect(m.uniforms.uExposureComp).toBe(exposureCompensation);
  });
  it("Ruangrapi's planetary ring is lit matter and is not compensated", () => {
    expect(makePlanetRingMaterial("#7dffc0", 18, 25).uniforms.uExposureComp).toBeUndefined();
  });
});
