import { describe, it, expect } from "vitest";
import { makePlanetRingMaterial, RING_NIGHT_FLOOR } from "../src/components/canvas/guideLine";
import * as THREE from "three";
import { bodySlot, SUN_SHADOW_CORE_GLSL, SUN_SHADOW_GLSL, sunShadowUniforms } from "../src/components/canvas/sunShadow";
import { makeBodyRingMaterial, makeUranusRingStrip } from "../src/components/canvas/bodyRings";
import { bodyById } from "../src/data/solarSystem";
import { displayAlbedoGain } from "../src/utils/displayAlbedo";
import { RING_TAU_MAX, URANUS_EPSILON, uranusRingTau } from "../src/utils/ringOptics";

describe("SUN_SHADOW_CORE_GLSL (the shared coverage maths)", () => {
  it("defines one-occluder visibility and is what the lit-material patch uses", () => {
    expect(SUN_SHADOW_CORE_GLSL).toMatch(/float\s+sunShadowCoverFrom\s*\(/);
    expect(SUN_SHADOW_CORE_GLSL).toMatch(/float\s+sunShadowVisibility\s*\(\s*vec3\s+p\s*,\s*vec4\s+o\s*\)/);
    // One copy of the maths: the patch includes the core rather than repeating it.
    expect(SUN_SHADOW_GLSL).toContain(SUN_SHADOW_CORE_GLSL);
    expect(SUN_SHADOW_GLSL.match(/asin\(\s*r \/ d\s*\)/g)).toHaveLength(1);
    expect(SUN_SHADOW_GLSL).toMatch(/sunShadowCoverFrom\(\s*p\s*,\s*u\s*,\s*sunDist\s*,\s*sunAng\s*,\s*uOccluders\[\s*k\s*\]\s*\)/);
  });
});

describe("makePlanetRingMaterial with a shadow slot", () => {
  it("is shadowed by that slot through the shared core, down to the night floor", () => {
    const m = makePlanetRingMaterial("#7dffc0", 18.4, 25.6, 0);
    expect(m.defines.SUN_SHADOW_RING).toBeDefined();
    expect(m.uniforms.uRingSlot.value).toBe(0);
    expect(m.uniforms.uOccluders).toBe(sunShadowUniforms.uOccluders);
    expect(m.uniforms.uNightFloor.value).toBe(RING_NIGHT_FLOOR.linear);
    expect(m.fragmentShader).toContain(SUN_SHADOW_CORE_GLSL);
    expect(m.fragmentShader).toMatch(/mix\(\s*uNightFloor\s*,\s*1\.0\s*,\s*sunShadowVisibility\(\s*vWorld\s*,\s*uOccluders\[\s*uRingSlot\s*\]\s*\)\s*\)/);
    expect(m.vertexShader).toMatch(/vWorld\s*=\s*\(\s*modelMatrix\s*\*/);
    // Measured floors (guideLine.ts): linear PostFX buffer, display-encoded low-perf.
    expect(RING_NIGHT_FLOOR.linear).toBeCloseTo(0.09, 2);
    expect(RING_NIGHT_FLOOR.display).toBeCloseTo(0.27, 2);
  });

  it("has no shadow without a slot (the define gates it)", () => {
    const m = makePlanetRingMaterial("#7dffc0", 18.4, 25.6);
    expect(m.defines.SUN_SHADOW_RING).toBeUndefined();
    expect(m.fragmentShader).toContain("#ifdef SUN_SHADOW_RING");
  });

  it("shares one program across slots: the slot is a uniform, not a define", () => {
    const a = makePlanetRingMaterial("#7dffc0", 18.4, 25.6, 0);
    const b = makePlanetRingMaterial("#7dffc0", 18.4, 25.6, 9);
    expect(a.defines).toEqual(b.defines);
    expect(a.fragmentShader).toBe(b.fragmentShader);
    expect(a.uniforms.uRingSlot.value).toBe(0);
    expect(b.uniforms.uRingSlot.value).toBe(9);
    expect(a.fragmentShader).toMatch(/uniform int uRingSlot;/);
  });
});

describe("each ring is shadowed by its own planet (L20)", () => {
  it("Saturn's by Saturn's slot (3), Uranus's by Uranus's (4), on one shared program", () => {
    const saturn = bodyById("saturn"), uranus = bodyById("uranus");
    const s = makeBodyRingMaterial(saturn, new THREE.Texture());
    const u = makeBodyRingMaterial(uranus, new THREE.Texture());
    expect(s.uniforms.uRingSlot.value).toBe(bodySlot("saturn"));
    expect(u.uniforms.uRingSlot.value).toBe(bodySlot("uranus"));
    expect([bodySlot("saturn"), bodySlot("uranus")]).toEqual([3, 4]);
    // One program: the same defines and source; the strip, slot and colour are uniforms.
    expect(u.defines).toEqual(s.defines);
    expect(u.fragmentShader).toBe(s.fragmentShader);
    expect(u.defines.SUN_SHADOW_RING).toBeDefined();
    expect(u.defines.RING_MAP).toBeDefined();
  });

  it("draws Uranus's ring at its albedo on the scene scale (0.177 × 0.02) through the dark-surface curve (P3)", () => {
    const uranus = bodyById("uranus");
    const u = makeBodyRingMaterial(uranus, new THREE.Texture());
    const lin = 0.177 * URANUS_EPSILON.albedo;
    const c = u.uniforms.uColor.value as THREE.Color;
    for (const ch of [c.r, c.g, c.b]) expect(ch).toBeCloseTo(lin * displayAlbedoGain(lin), 9);
    // Saturn's colour lives in its strip: white.
    expect((makeBodyRingMaterial(bodyById("saturn"), new THREE.Texture()).uniforms.uColor.value as THREE.Color).toArray()).toEqual([1, 1, 1]);
  });

  it("builds Uranus's strip from the ε profile: white, τ / RING_TAU_MAX in alpha, no mipmaps", () => {
    const tex = makeUranusRingStrip();
    const { data, width } = tex.image as { data: Uint8Array; width: number };
    for (let x = 0; x < width; x++) {
      expect(data[x * 4]).toBe(255);
      const tau = (data[x * 4 + 3] / 255) * RING_TAU_MAX;
      expect(tau).toBeCloseTo(uranusRingTau((x + 0.5) / width), 1);
    }
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
  });
});
