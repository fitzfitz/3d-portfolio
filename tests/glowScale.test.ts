import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AU } from "../src/constants";
import * as THREE from "three";
import {
  cutExposure, EXPOSURE_LIFT, exposureCompensation, glowScale, glowScaleUnmapped, mappedCompensation,
  setExposureCompensation, targetExposure,
} from "../src/utils/sunLight";
import { makePlumeMaterial } from "../src/components/canvas/enginePlume";
import { applyGlow, collectGlowMaterials } from "../src/components/canvas/glowMaterials";

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

// Which stage exposes a material decides its factor (sunLight.ts). Tone-mapped
// materials (built-ins, patched built-ins) are exposed by the post pass in the
// full tier and by the renderer in low-perf; custom shaders without
// <tonemapping_fragment> and toneMapped: false materials only by the post pass.
const exposedBy = (toneMapped: boolean, fullTier: boolean, e: number) => (toneMapped || fullTier ? e : 1);
const TIERS = [{ name: "full", full: true }, { name: "low-perf", full: false }];
const DISTANCES = [{ name: "1 AU", d: AU }, { name: "13 AU", d: 13 * AU }];

describe("each compensated glow takes the factor its material needs, in both tiers (N8)", () => {
  afterEach(() => setExposureCompensation(EXPOSURE_LIFT, true));

  for (const t of TIERS) for (const at of DISTANCES) {
    it(`${t.name} at ${at.name}: a tone-mapped glow × mappedCompensation and an unmapped one × exposureCompensation read at their base`, () => {
      const e = targetExposure(at.d);
      setExposureCompensation(e, t.full);
      // The Nest's slime glow, jet and smoke, the monsters' and bottles' emissives.
      expect(mappedCompensation.value * exposedBy(true, t.full, e)).toBeCloseTo(1, 12);
      // From 1 AU out it is glowScale / EXPOSURE_LIFT (the Nest sits at ~4 AU).
      expect(mappedCompensation.value).toBeCloseTo(glowScale.value / EXPOSURE_LIFT, 12);
      // The bolts and sparks (toneMapped: false), the sun, the guide lines.
      expect(exposureCompensation.value * exposedBy(false, t.full, e)).toBeCloseTo(1, 12);
      // The full tier's look is unchanged: the two agree there.
      if (t.full) expect(mappedCompensation.value).toBe(exposureCompensation.value);
    });
  }

  it("the old choice (exposureCompensation on a tone-mapped glow) is e× too bright in low-perf at 13 AU", () => {
    const e = targetExposure(13 * AU);
    setExposureCompensation(e, false);
    expect(exposureCompensation.value * exposedBy(true, false, e)).toBeCloseTo(e, 9);
    expect(e).toBeGreaterThan(13);
  });

  it("the glow factors hold both kinds at their 1 AU glow far out, in both tiers", () => {
    for (const t of TIERS) {
      const net = DISTANCES.map((at) => {
        const e = targetExposure(at.d);
        setExposureCompensation(e, t.full);
        return [glowScale.value * exposedBy(true, t.full, e), glowScaleUnmapped.value * exposedBy(false, t.full, e)];
      });
      // Tone-mapped: the 1 AU lift in both tiers. Unmapped: the lift where the
      // post pass exposes, the base in low-perf (nothing exposes it there).
      expect(net[0][0], t.name).toBeCloseTo(EXPOSURE_LIFT, 9);
      expect(net[1][0], t.name).toBeCloseTo(EXPOSURE_LIFT, 9);
      expect(net[0][1], t.name).toBeCloseTo(t.full ? EXPOSURE_LIFT : 1, 9);
      expect(net[1][1], t.name).toBeCloseTo(net[0][1], 9);
    }
  });

  it("each user reads the factor of its material kind", () => {
    const cluster = src("nest", "NestCluster.tsx");
    expect(cluster).toMatch(/new THREE\.PointsMaterial\(/);
    expect(cluster).not.toMatch(/toneMapped/);
    expect(cluster).toMatch(/const comp = mappedCompensation\.value/);
    expect(cluster).not.toMatch(/exposureCompensation\.value/);
    const fx = src("nest", "NestEffects.tsx");
    // The bolts' mesh is toneMapped: false, the jet and smoke Points are not.
    expect(fx.match(/depthWrite: false, toneMapped: false/g)?.length).toBe(1);
    expect(fx.match(/new THREE\.PointsMaterial\(\{[^}]*toneMapped/g)).toBeNull();
    expect(fx).toMatch(/const comp = exposureCompensation\.value/);
    expect(fx).toMatch(/color\.setScalar\(comp\)/);
    expect(fx).toMatch(/JET_GLOW \* jetGlow\(q\) \* mapped \*/);
    expect(fx).toMatch(/SMOKE_GREY\[0\] \* mapped/);
    expect(src("Bottles.tsx")).toMatch(/uExposureComp = mappedCompensation/);
  });
});

describe("the portal and the career station hold their 1 AU glow far out (N9)", () => {
  it("the membrane reads glowScaleUnmapped; the neons, auras and core glowScale; the dock light glowScale", () => {
    const sp = src("SpacePlanets.tsx");
    expect(sp).toMatch(/uGlow: glowScaleUnmapped/);
    expect(sp).toMatch(/\* uGlow, alpha\)/);
    expect(sp).not.toMatch(/#include <tonemapping_fragment>/);
    expect(sp).toMatch(/const glow = glowScale\.value/);
    expect(sp).toMatch(/applyGlow\(portalNeons, glow\)/);
    for (const c of ["PORTAL_OUTER_AURA", "PORTAL_INNER_AURA", "PORTAL_CORE"]) {
      expect(sp, c).toMatch(new RegExp(`copy\\(${c}\\)\\.multiplyScalar\\(glow\\)`));
    }
    expect(src("CareerStation.tsx")).toMatch(/applyGlow\(dockLights, glowScale\.value\)/);
  });

  it("the GLBs' self-lit materials are the ones the patterns pick", () => {
    const mats = (f: string) => {
      const b = readFileSync(join("public", "models", f));
      const doc = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8"));
      return (doc.materials as { name: string; emissiveFactor?: number[] }[]);
    };
    const neon = mats("portal_gateway.glb").filter((m) => /^neon_/i.test(m.name)).map((m) => m.name).sort();
    expect(neon).toEqual(["Neon_Cyan", "Neon_Pink"]);
    const dock = mats("career_station.glb").filter((m) => /^docklight$/i.test(m.name));
    expect(dock.map((m) => m.name)).toEqual(["DockLight"]);
    expect(dock[0].emissiveFactor).toBeTruthy();
  });

  it("collectGlowMaterials captures each base once, so the writes never compound", () => {
    const neon = new THREE.MeshStandardMaterial({ name: "Neon_Pink", emissive: "#ff0000", emissiveIntensity: 1.85 });
    const hull = new THREE.MeshStandardMaterial({ name: "Hull", emissive: "#ff0000", emissiveIntensity: 0.5 });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), neon), new THREE.Mesh(new THREE.BufferGeometry(), neon),
      new THREE.Mesh(new THREE.BufferGeometry(), hull));
    const list = collectGlowMaterials(root, /^neon_/i);
    expect(list.length).toBe(1);
    applyGlow(list, 0.25);
    expect(neon.emissiveIntensity).toBeCloseTo(0.4625, 12);
    // A remount collects again from the already-scaled material: the base stays the original.
    const again = collectGlowMaterials(root, /^neon_/i);
    expect(again[0].base).toBeCloseTo(1.85, 12);
    applyGlow(again, 1);
    expect(neon.emissiveIntensity).toBeCloseTo(1.85, 12);
    expect(hull.emissiveIntensity).toBe(0.5);
  });
});
