import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AU } from "../src/constants";
import {
  cutExposure, EXPOSURE_LIFT, glowScale, glowScaleUnmapped, setExposureCompensation, targetExposure,
} from "../src/utils/sunLight";
import { makePlumeMaterial } from "../src/components/canvas/enginePlume";

const src = (...p: string[]) => readFileSync(join("src", "components", "canvas", ...p), "utf8");

// Self-lit things (emissive strips, plumes, the jellyfish, beacons) are not
// sunlit, so the camera's exposure, which grows as (d / AU)² to cancel the
// falling sunlight, would brighten them with distance. glowScale undoes the
// exposure above its 1 AU value, so they read the same from 1 AU out
// (spec 2026-10-27-nest-playable §5).
describe("glowScale holds self-lit things at their 1 AU brightness", () => {
  afterEach(() => setExposureCompensation(EXPOSURE_LIFT, true));

  it("undoes the exposure above the 1 AU lift and never brightens", () => {
    setExposureCompensation(EXPOSURE_LIFT, true);
    expect([glowScale.value, glowScaleUnmapped.value]).toEqual([1, 1]);
    setExposureCompensation(0.5, true);
    expect(glowScale.value).toBe(1);
    setExposureCompensation(targetExposure(13 * AU), true);
    expect(glowScale.value).toBeCloseTo(1 / 169, 12);
    expect(glowScaleUnmapped.value).toBeCloseTo(1 / 169, 12);
    setExposureCompensation(6, false);
    expect(glowScale.value).toBeCloseTo(0.25, 12);
    expect(glowScaleUnmapped.value).toBe(1);
    for (const d of [AU, 2 * AU, 3.5 * AU, 13 * AU]) {
      const e = targetExposure(d);
      setExposureCompensation(e, true);
      expect(glowScale.value * e, `d=${d}`).toBeCloseTo(EXPOSURE_LIFT, 9);
    }
  });

  it("a camera cut sets it too", () => {
    cutExposure({ toneMappingExposure: 1 }, 13 * AU, true);
    expect(glowScale.value).toBeCloseTo(1 / 169, 12);
  });

  it("every plume shares the one unmapped factor", () => {
    expect(makePlumeMaterial(1).uniforms.uGlow).toBe(glowScaleUnmapped);
  });

  it("each self-lit source reads its factor", () => {
    for (const f of ["enginePlume.ts", "SpaceJellyfish.tsx"]) {
      const s = src(f);
      expect(s, f).toMatch(/uGlow: glowScaleUnmapped/);
      expect(s, f).toMatch(/\* uGlow/);
    }
    expect(src("EngineWake.tsx")).toMatch(/uGlow: glowScale\b/);
    expect(src("Ghosts.tsx")).toMatch(/glowScaleUnmapped\.value/);
    for (const f of ["Spaceship.tsx", "ProjectProbes.tsx", "DataShards.tsx", "PortalRing.tsx", "CareerTrail.tsx", "CargoTraffic.tsx", "TractorBeam.tsx", join("nest", "NestBuoy.tsx")]) {
      expect(src(f), f).toMatch(/glowScale\.value/);
    }
  });
});
