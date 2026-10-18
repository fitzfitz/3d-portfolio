import { describe, it, expect } from "vitest";
import { makePlanetRingMaterial, RING_NIGHT_FLOOR } from "../src/components/canvas/guideLine";
import { SUN_SHADOW_CORE_GLSL, SUN_SHADOW_GLSL, sunShadowUniforms } from "../src/components/canvas/sunShadow";

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
