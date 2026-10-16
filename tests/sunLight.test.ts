import { describe, it, expect } from "vitest";
import { AU } from "../src/constants";
import {
  sunIrradiance,
  targetExposure,
  stepExposure,
  exposureCompensation,
  setExposureCompensation,
  SUN_LIGHT_INTENSITY,
} from "../src/utils/sunLight";

describe("sunlight falls with distance squared; the camera's exposure follows (F3, L19)", () => {
  it("irradiance at 1 AU is today's 2.1, and falls with distance squared", () => {
    expect(sunIrradiance(AU)).toBeCloseTo(2.1, 9);
    expect(sunIrradiance(2 * AU)).toBeCloseTo(2.1 / 4, 9);
  });
  it("exposure is exactly 1 at 1 AU and follows (d/AU)^1.5 between the clamps", () => {
    expect(targetExposure(AU)).toBeCloseTo(1, 12);
    expect(targetExposure(185)).toBeCloseTo((185 / 115) ** 1.5, 9);
    expect(targetExposure(1)).toBe(0.15);
    expect(targetExposure(10_000)).toBe(2.5);
  });
  it("the outer system reads dimmer but readable; the spawn reads as today", () => {
    const net = (d: number) => (sunIrradiance(d) * targetExposure(d)) / 2.1;
    expect(net(185)).toBeCloseTo(0.79, 2);
    expect(net(250)).toBeCloseTo(0.53, 2);
    expect(net(105.4)).toBeGreaterThan(0.95);
    expect(net(105.4)).toBeLessThan(1.15);
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
});
