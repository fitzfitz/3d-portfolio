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
  ringRadiance, ringRadii, ringTransmission, ringViewOpacity,
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

describe("ringRadiance: single scattering in a layer of depth τ, both faces", () => {
  const MU0 = [0.05, 0.2, 0.45, 1];
  const MU = [0.2, 0.5, 1];

  it("tends to τ/|μ| (×2) for a thin layer, whatever the sun's elevation, on either face", () => {
    const tau = 1e-4;
    for (const mu0 of MU0) for (const mu of MU) {
      expect(ringRadiance(tau, mu0, mu) / (2 * tau / mu)).toBeCloseTo(1, 2);
      expect(ringRadiance(tau, mu0, -mu) / (2 * tau / mu)).toBeCloseTo(1, 2);
    }
  });

  it("does not darken thin rings under a low sun the way μ₀/(μ₀+μ)·(1 − e^(−τ/μ)) did", () => {
    // The review's case: μ₀ = 0.2, μ = 0.5. The old output was too dark by
    // 2.8× for τ = 0.1 and 1.5× for τ = 0.5; the B ring (τ = 2) was right.
    const old = (tau: number) => 2 * 0.2 / 0.7 * (1 - Math.exp(-tau / 0.5));
    expect(ringRadiance(0.1, 0.2, 0.5) / old(0.1)).toBeGreaterThan(2.5);
    expect(ringRadiance(0.5, 0.2, 0.5) / old(0.5)).toBeGreaterThan(1.4);
    expect(ringRadiance(2, 0.2, 0.5) / old(2)).toBeLessThan(1.1);
  });

  it("is Lommel–Seeliger, 2μ₀/(μ₀+μ), for a thick layer's lit face, and Lambert's 1 face-on", () => {
    for (const mu0 of MU0) for (const mu of MU) {
      expect(ringRadiance(60, mu0, mu)).toBeCloseTo(2 * mu0 / (mu0 + mu), 6);
    }
    expect(ringRadiance(60, 1, 1)).toBeCloseTo(1, 6);
  });

  it("lets nothing through a thick layer to its unlit face, and is never brighter there than on the lit face", () => {
    expect(ringRadiance(60, 0.3, -0.5)).toBeLessThan(1e-12);
    for (const tau of [0.01, 0.1, 0.5, 1, 2, 4]) for (const mu0 of MU0) for (const mu of MU) {
      expect(ringRadiance(tau, mu0, -mu)).toBeLessThanOrEqual(ringRadiance(tau, mu0, mu) + 1e-12);
    }
  });

  it("is continuous across μ = μ₀ on the unlit face, where the difference form cancels", () => {
    for (const tau of [0.05, 0.5, 2]) {
      const at = ringRadiance(tau, 0.3, -0.3);
      expect(at).toBeCloseTo(2 * (tau / 0.3) * Math.exp(-tau / 0.3), 9);
      expect(ringRadiance(tau, 0.3, -0.3001)).toBeCloseTo(at, 3);
      expect(ringRadiance(tau, 0.3, -0.31)).toBeCloseTo(at, 1);
    }
  });

  it("is 0 where the strip is empty, and finite edge-on or with the sun in the ring plane", () => {
    expect(ringRadiance(0, 0.3, 0.5)).toBe(0);
    expect(ringRadiance(0, 0.3, -0.5)).toBe(0);
    for (const [mu0, mu] of [[0, 0.5], [0.3, 0], [0, 0], [0, -0.5], [-0.3, 0]]) {
      expect(Number.isFinite(ringRadiance(1, mu0, mu))).toBe(true);
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
    expect(m.premultipliedAlpha).toBe(false); // its blending, and so its program, unchanged
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
    // ringRadiance: the full layer, the incident path's e^(−τ/μ₀) included,
    // written as premultiplied colour so no division by the opacity is needed.
    expect(m.fragmentShader).toMatch(/x\s*\/\s*max\(\s*x\s*\+\s*x0\s*,[^)]*\)\s*\*\s*\(\s*1\.0\s*-\s*exp\(\s*-\s*\(\s*x\s*\+\s*x0\s*\)\s*\)\s*\)/);
    expect(m.fragmentShader).toMatch(/\(\s*exp\(\s*-x0\s*\)\s*-\s*exp\(\s*-x\s*\)\s*\)\s*\/\s*\(\s*x\s*-\s*x0\s*\)/);
    expect(m.fragmentShader).not.toContain("RING_FORWARD");
    // τ = 0 texels (the gaps and the strip's ends) return 0 before any
    // division: under a mediump fallback a tiny epsilon flushes to 0, and
    // 0/0 is a NaN that corrupts the premultiplied pixel (ringOptics.ts does the same).
    expect(m.fragmentShader).toMatch(/float ringRadiance\([^)]*\)\s*\{\s*if\s*\(\s*tau\s*<=\s*0\.0\s*\)\s*return 0\.0;/);
    const eps = Number(/max\(\s*x\s*\+\s*x0\s*,\s*([0-9.e+-]+)\s*\)/.exec(m.fragmentShader)![1]);
    expect(eps).toBeGreaterThanOrEqual(6.2e-5); // mediump's smallest normal is 2^-14 ≈ 6.1e-5
    expect(m.premultipliedAlpha).toBe(true);
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
