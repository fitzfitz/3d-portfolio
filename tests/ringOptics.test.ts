import { describe, it, expect } from "vitest";
import sharp from "sharp";
import * as THREE from "three";
import { makePlanetRingMaterial } from "../src/components/canvas/guideLine";
import { patchSunShadow } from "../src/components/canvas/sunShadow";
import { planets } from "../src/constants";
import { WORLDS } from "../src/data/worlds";
import { irradianceVsAU } from "../src/utils/sunLight";
import {
  fluidRocheLimit, RING_ICE_DENSITY, RING_IN, RING_OUT, RING_TAU_MAX, RINGED_GIANT_DENSITY,
  ringRadii, ringTransmission, ringViewOpacity,
} from "../src/utils/ringOptics";

/**
 * The ringed giant's rings (docs/UNIVERSE-RULES.md L14, L20): the optics the
 * ring shader and the planet's ring-shadow patch compute, through their pure
 * mirrors, and the Roche limit the A ring's edge sits at.
 */

const ringed = WORLDS.find((w) => w.id === "w-ringed")!;

describe("ringViewOpacity: 1 − exp(−τ/|μ|)", () => {
  it("equals 1 − e^(−τ) face-on, from either side", () => {
    for (const tau of [0.05, 0.5, 2]) {
      expect(ringViewOpacity(tau, 1)).toBeCloseTo(1 - Math.exp(-tau), 12);
      expect(ringViewOpacity(tau, -1)).toBeCloseTo(1 - Math.exp(-tau), 12);
    }
  });

  it("rises toward 1 as μ → 0 (edge-on)", () => {
    const tau = 0.1; // a C-ring value: thin face-on
    let prev = ringViewOpacity(tau, 1);
    for (const mu of [0.5, 0.2, 0.05, 0.01, 0.001]) {
      const a = ringViewOpacity(tau, mu);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
    expect(prev).toBeGreaterThan(0.999);
  });
});

describe("ringTransmission: exp(−τ/μ₀), the sunlight the rings let through to the planet", () => {
  it("depends on μ₀ only (no viewer term)", () => {
    expect(ringTransmission.length).toBe(2);
    expect(ringTransmission(0.5, 1)).toBeCloseTo(Math.exp(-0.5), 12);
    expect(ringTransmission(0.5, 0.25)).toBeCloseTo(Math.exp(-2), 12);
    expect(ringTransmission(0, 0.1)).toBe(1);
  });

  it("lets the B ring's shadow through at under half its face-on value for μ₀ ≤ 0.45", async () => {
    // τ from the shipped strip itself: A = τ / RING_TAU_MAX.
    const { data, info } = await sharp("public/models/w-ringed_ring.webp").raw().toBuffer({ resolveWithObject: true });
    const w = info.width;
    const bTau: number[] = [];
    for (let x = 0; x < w; x++) {
      const R = RING_IN + ((x + 0.5) / w) * (RING_OUT - RING_IN);
      if (R >= 1.53 && R <= 1.95) bTau.push((data[x * info.channels + 3] / 255) * RING_TAU_MAX);
    }
    const tau = bTau.reduce((s, v) => s + v, 0) / bTau.length;
    for (const mu0 of [0.45, 0.3, 0.1]) {
      expect(ringTransmission(tau, mu0)).toBeLessThan(0.5 * ringTransmission(tau, 1));
    }
  });
});

describe("the ring material", () => {
  it("leaves Ruangrapi's ring without RING_MAP (its program is unchanged), at ×1 irradiance", () => {
    const m = makePlanetRingMaterial("#7dffc0", planets[0].size * 1.15, planets[0].size * 1.6, 0, {
      irradiance: irradianceVsAU(planets[0].orbit.radius),
    });
    expect(m.defines.RING_MAP).toBeUndefined();
    expect(m.fragmentShader).toContain("#ifdef RING_MAP");
    expect(m.uniforms.uIrradiance.value).toBeCloseTo(1, 12);
    expect(makePlanetRingMaterial("#7dffc0", 18.4, 25.6).uniforms.uIrradiance.value).toBe(1);
  });

  it("samples the strip behind RING_MAP, with the opacity and Lommel–Seeliger light of the mirrors", () => {
    const map = new THREE.Texture();
    const m = makePlanetRingMaterial("#ffffff", 18.6, 34.05, 9, { ringMap: map, irradiance: 0.18 });
    expect(m.defines.RING_MAP).toBeDefined();
    expect(m.defines.SUN_SHADOW_RING).toBeDefined();
    expect(m.uniforms.uRingMap.value).toBe(map);
    expect(m.uniforms.uTauMax.value).toBe(RING_TAU_MAX);
    expect(m.uniforms.uIrradiance.value).toBe(0.18);
    expect(m.fragmentShader).toMatch(/1\.0\s*-\s*exp\(\s*-\s*tau\s*\/\s*amu\s*\)/);
    expect(m.fragmentShader).toMatch(/amu0\s*\/\s*\(\s*amu0\s*\+\s*amu\s*\)/);
    // Same program for any slot and map: both are uniforms.
    const n = makePlanetRingMaterial("#ffffff", 18.6, 34.05, 3, { ringMap: new THREE.Texture(), irradiance: 0.5 });
    expect(n.fragmentShader).toBe(m.fragmentShader);
    expect(n.defines).toEqual(m.defines);
  });
});

describe("the planet's ring-shadow patch", () => {
  it("adds one program key and wires the ring plane, radii and strip", () => {
    const normal = { value: new THREE.Vector3(0, 1, 0) };
    const map = new THREE.Texture();
    const plain = new THREE.MeshStandardMaterial();
    const ringedMat = new THREE.MeshStandardMaterial();
    patchSunShadow(plain, "fragment");
    patchSunShadow(ringedMat, "fragment", { ringShadow: { normal, inner: 18.6, outer: 34.05, map } });
    expect(ringedMat.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());

    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    ringedMat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uRingShadowNormal).toBe(normal);
    expect(shader.uniforms.uRingShadowMap.value).toBe(map);
    expect(shader.uniforms.uRingShadowRadii.value.toArray()).toEqual([18.6, 34.05]);
    // exp(−τ/μ₀) per tap of the sun-disc blur, gating only the sun's light.
    expect(shader.fragmentShader).toMatch(/exp\(\s*-ringShadowTau\([^;]*\)\s*\/\s*mu0\s*\)/);
    expect(shader.fragmentShader).toContain("directLight.color *= sunShadowRingGate( sunShadowWorld( geometryPosition ) );");
    expect(shader.vertexShader).toContain("vRingShadowCentre");
  });
});

describe("Roche limit (L14)", () => {
  it("puts the A ring's outer edge at 2.27 × the equatorial size, at the fluid limit (≈ 2.22, within 0.06)", () => {
    const [inner, outer] = ringRadii(ringed.size);
    expect(outer).toBeCloseTo(2.27 * ringed.size, 10);
    expect(inner).toBeCloseTo(1.24 * ringed.size, 10);
    const roche = fluidRocheLimit(RINGED_GIANT_DENSITY, RING_ICE_DENSITY);
    expect(roche).toBeCloseTo(2.44 * Math.cbrt(0.69 / 0.92), 12);
    expect(roche).toBeCloseTo(2.22, 2);
    expect(Math.abs(RING_OUT - roche)).toBeLessThan(0.06);
  });

  it("matches the strip generator's extent and τ scale", async () => {
    const gen = await import("../scripts/textures/gen_worlds.mjs");
    expect([gen.RING_IN, gen.RING_OUT, gen.RING_TAU_MAX]).toEqual([RING_IN, RING_OUT, RING_TAU_MAX]);
  });
});
