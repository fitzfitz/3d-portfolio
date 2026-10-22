import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import {
  LAND_ROUGHNESS, SEA_ROUGHNESS, WATER_IOR, dielectricF0, oceanSurface, patchOceanGloss,
} from "../src/components/canvas/oceanGloss";
import { patchNightGlow } from "../src/components/canvas/nightGlow";
import { patchSunShadow } from "../src/components/canvas/sunShadow";

/** Runs a material's compile hook over three's own physical shader, as the renderer would. */
function compiled(m: THREE.Material) {
  const lib = THREE.ShaderLib.physical;
  const shader = {
    uniforms: THREE.UniformsUtils.clone(lib.uniforms),
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe("Earth's sea is water and its land is matte (FOLLOW-UPS: the ocean sheen)", () => {
  it("water's F0 is 0.02 (ior 1.333), against the 0.04 three gives every dielectric", () => {
    expect(dielectricF0(WATER_IOR)).toBeCloseTo(0.02, 3);
    expect(dielectricF0(1.5)).toBeCloseTo(0.04, 3);
  });

  it("the sea keeps a wind-roughened gloss (Cox–Munk at ~4.5 m/s); the land and ice take every body's matte", () => {
    expect(SEA_ROUGHNESS).toBe(0.4);
    expect(LAND_ROUGHNESS).toBe(0.95);
    // The CPU mirror of the shader's mix, over the map's alpha (1 = water).
    expect(oceanSurface(1)).toEqual({ roughness: SEA_ROUGHNESS, f0: dielectricF0(WATER_IOR) });
    const land = oceanSurface(0);
    expect(land.roughness).toBe(LAND_ROUGHNESS);
    expect(land.f0).toBeCloseTo(0.04, 3);
  });

  it("reads the mask from the map's alpha: the sea's gloss and water's ior, the land's matte and 0.04", () => {
    const m = new THREE.MeshPhysicalMaterial({ map: new THREE.Texture(), ior: WATER_IOR });
    patchOceanGloss(m);
    const fs = compiled(m).fragmentShader;
    expect(fs).not.toContain("#include <roughnessmap_fragment>");
    expect(fs).toMatch(/float oceanMask = sampledDiffuseColor\.a;/);
    expect(fs).toMatch(/roughnessFactor = mix\( 0\.950*, 0\.40*, oceanMask \)/);
    // Land keeps three's dielectric 0.04 (ior 1.5); only the sea is water.
    expect(fs).toMatch(/material\.ior = mix\( 1\.50*, ior, oceanMask \);/);
    expect(fs).not.toContain("#include <lights_physical_fragment>");
  });

  it("composes with the night lights and the sun shadow, in Earth's own program (not Io's)", () => {
    const earth = new THREE.MeshPhysicalMaterial({ map: new THREE.Texture(), ior: WATER_IOR });
    patchNightGlow(earth);
    patchOceanGloss(earth);
    patchSunShadow(earth, "fragment");
    const fs = compiled(earth).fragmentShader;
    expect(fs).toContain("uNightEclipse"); // nightGlow ran
    expect(fs).toContain("uOccluders"); // sunShadow ran
    expect(fs).toContain("oceanMask");
    const io = new THREE.MeshStandardMaterial();
    patchNightGlow(io);
    patchSunShadow(io, "fragment");
    expect(earth.customProgramCacheKey()).not.toBe(io.customProgramCacheKey());
    expect(earth.customProgramCacheKey()).toContain("ocean");
  });

  it("is how SolarBodies draws Earth: after the night lights, before the sun shadow", () => {
    const src = readFileSync("src/components/canvas/SolarBodies.tsx", "utf8");
    expect(src).toMatch(/new THREE\.MeshPhysicalMaterial\(\{ map, ior: WATER_IOR/);
    const glow = src.indexOf("patchNightGlow(m)"), ocean = src.indexOf("patchOceanGloss(m)"), shadow = src.indexOf("patchSunShadow(m,");
    expect(glow).toBeGreaterThan(0);
    expect(ocean).toBeGreaterThan(glow);
    expect(shadow).toBeGreaterThan(ocean);
  });
});
