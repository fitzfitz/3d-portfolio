import { describe, it, expect } from "vitest";
import { AU, PLANET_ORBITS, SYSTEM_RADIUS } from "../src/constants";
import { makePlanetRingMaterial } from "../src/components/canvas/guideLine";
import { makeAtmosphereMaterial } from "../src/components/canvas/atmosphereMaterial";
import { ICE_GIANT_DUSK } from "../src/components/canvas/SpaceWorlds";
import {
  sunIrradiance,
  targetExposure,
  stepExposure,
  exposureCompensation,
  litExposure,
  setExposureCompensation,
  EXPOSURE_MAX,
  EXPOSURE_MIN,
  EXPOSURE_POWER,
  SUN_LIGHT_INTENSITY,
  irradianceVsAU,
  cutExposure,
} from "../src/utils/sunLight";

describe("sunlight falls with distance squared; the camera's exposure follows (F3, L19)", () => {
  it("irradiance at 1 AU is today's 2.1, and falls with distance squared", () => {
    expect(sunIrradiance(AU)).toBeCloseTo(2.1, 9);
    expect(sunIrradiance(2 * AU)).toBeCloseTo(2.1 / 4, 9);
  });
  it("exposure is exactly 1 at 1 AU and follows (d/AU)^2 between the clamps", () => {
    expect(EXPOSURE_POWER).toBe(2);
    expect(targetExposure(AU)).toBeCloseTo(1, 12);
    expect(targetExposure(185)).toBeCloseTo((185 / 115) ** 2, 9);
    expect(targetExposure(1)).toBe(0.15);
    expect(targetExposure(10_000)).toBe(EXPOSURE_MAX);
  });
  it("the exposure ceiling is the edge's own exposure, derived from SYSTEM_RADIUS", () => {
    expect(EXPOSURE_MAX).toBe((SYSTEM_RADIUS / AU) ** EXPOSURE_POWER);
    expect(EXPOSURE_MAX).toBeCloseTo((480 / 115) ** 2, 9);
    expect(EXPOSURE_MAX).toBeCloseTo(17.42, 2);
    expect(targetExposure(SYSTEM_RADIUS)).toBeCloseTo(EXPOSURE_MAX, 12);
  });
  it("the near-sun floor 0.15 starts at AU·√0.15 ≈ 44.5, just inside the belt (r 40-70), not at the spawn", () => {
    const floorStart = AU * Math.sqrt(EXPOSURE_MIN);
    expect(floorStart).toBeCloseTo(44.54, 2);
    expect(targetExposure(floorStart + 0.01)).toBeGreaterThan(EXPOSURE_MIN);
    expect(targetExposure(floorStart - 0.01)).toBe(EXPOSURE_MIN);
    expect(targetExposure(40)).toBe(EXPOSURE_MIN); // the belt's inner edge: was (40/115)^1.5 ≈ 0.205
    expect(targetExposure(48)).toBeCloseTo((48 / 115) ** 2, 12); // the sky probe's near stop is unclamped
    expect(targetExposure(105.4)).toBeCloseTo((105.4 / 115) ** 2, 12); // the spawn
  });
  it("the camera adapts fully: a lit surface reads at its 1 AU brightness at every distance inside the clamps", () => {
    const net = (d: number) => (sunIrradiance(d) * targetExposure(d)) / 2.1;
    // Exposure (d/AU)^2 cancels inverse-square sunlight (AU/d)^2 exactly.
    for (const r of [AU * Math.sqrt(EXPOSURE_MIN), 48, 105.4, 115, 150, 185, 210, 242, 300, 358, 402, SYSTEM_RADIUS]) {
      expect(net(r), `r=${r}`).toBeCloseTo(1, 12);
    }
    // Outside the clamps it does not: brighter near the sun under the floor, dimmer past the edge.
    expect(net(40)).toBeCloseTo(EXPOSURE_MIN * (AU / 40) ** 2, 12);
    expect(net(40)).toBeGreaterThan(1.2);
    expect(net(2 * SYSTEM_RADIUS)).toBeCloseTo(0.25, 12);
  });
  it("eases with a 1.5 s half-life and snaps when asked", () => {
    expect(stepExposure(1, 2, 1.5, false)).toBeCloseTo(1.5, 9);
    expect(stepExposure(1, 2, 0.016, true)).toBe(2);
  });
  it("the point light's intensity gives 2.1 at 1 AU under decay 2", () => {
    expect(SUN_LIGHT_INTENSITY / (AU * AU)).toBeCloseTo(2.1, 9);
  });
  it("compensation undoes the exposure only where the post pass applies it", () => {
    setExposureCompensation(0.25, true);
    expect(exposureCompensation.value).toBeCloseTo(4, 12);
    setExposureCompensation(0.25, false);
    expect(exposureCompensation.value).toBe(1);
    setExposureCompensation(1, true);
    expect(exposureCompensation.value).toBe(1);
  });
  it("lit custom shaders get the exposure only where nothing else applies it (low-perf)", () => {
    setExposureCompensation(2.75, false);
    expect(litExposure.value).toBe(2.75);
    setExposureCompensation(2.75, true);
    expect(litExposure.value).toBe(1);
  });
  it("the planetary ring and the atmosphere rim read the shared lit-exposure uniform", () => {
    const ring = makePlanetRingMaterial("#ffffff", 1.2, 2.2, 0);
    const rim = makeAtmosphereMaterial({ color: "#88aaff", planetPos: { x: 300, y: 0, z: 0 }, orbitRadius: 300 });
    for (const m of [ring, rim]) {
      expect(m.uniforms.uLitExposure).toBe(litExposure);
      expect(m.fragmentShader).toMatch(/uniform float uLitExposure;/);
    }
    expect(ring.fragmentShader).toMatch(/gl_FragColor = vec4\(col \* uLitExposure, a\)/);
    expect(rim.fragmentShader).toMatch(/gl_FragColor = vec4\(col, a \* uLitExposure\)/);
    setExposureCompensation(5.5, false);
    expect(ring.uniforms.uLitExposure.value).toBe(5.5);
    expect(rim.uniforms.uLitExposure.value).toBe(5.5);
    setExposureCompensation(5.5, true);
    expect(ring.uniforms.uLitExposure.value).toBe(1);
    expect(rim.uniforms.uLitExposure.value).toBe(1);
  });
  it("the atmosphere's dusk band is a uniform, the old orange by default, a methane-cool tint when given", () => {
    const rim = makeAtmosphereMaterial({ color: "#88aaff" });
    expect(rim.fragmentShader).toMatch(/uniform vec3 uDusk;/);
    expect(rim.fragmentShader).toMatch(/mix\(uColor, uDusk, dusk \* 0\.55\)/);
    expect(rim.fragmentShader).not.toMatch(/vec3\(1\.0, 0\.62, 0\.38\)/);
    expect(rim.uniforms.uDusk.value.toArray()).toEqual([1.0, 0.62, 0.38]);
    const cool = makeAtmosphereMaterial({ color: "#88aaff", dusk: ICE_GIANT_DUSK }).uniforms.uDusk.value;
    expect(cool.b).toBeGreaterThan(cool.r); // methane absorbs red: the terminator does not redden
  });
  it("atmosphere rims scale with the sunlight at each planet's orbit (L27 under L19)", () => {
    expect(irradianceVsAU(PLANET_ORBITS.ruangrapi.radius)).toBeCloseTo(1, 12);
    expect(irradianceVsAU(PLANET_ORBITS.portfolio.radius)).toBeCloseTo(0.588, 3);
    expect(irradianceVsAU(PLANET_ORBITS.fuxx.radius)).toBeCloseTo(0.386, 3);
  });
  it("a camera cut re-meters the exposure on the spot, tier-correct (I2)", () => {
    const gl = { toneMappingExposure: 0.15 }; // adapted to the sun's glare
    cutExposure(gl, 230, true);
    expect(gl.toneMappingExposure).toBeCloseTo(targetExposure(230), 12);
    expect(exposureCompensation.value).toBeCloseTo(1 / targetExposure(230), 12);
    cutExposure(gl, 40, false);
    expect(gl.toneMappingExposure).toBeCloseTo(targetExposure(40), 12);
    expect(exposureCompensation.value).toBe(1);
    expect(litExposure.value).toBeCloseTo(targetExposure(40), 12);
  });
});
