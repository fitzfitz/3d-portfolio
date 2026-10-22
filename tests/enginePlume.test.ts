import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { makePlumeMaterial, makeBeamGeometry, makePlumeGeometry, plumeRootFade, plumeSpreadFor, PLUME_HALF_ANGLE_DEG } from "../src/components/canvas/enginePlume";

describe("makePlumeMaterial", () => {
  it("defaults to the engine's cyan and accepts a tint without changing the shader source", () => {
    const engine = makePlumeMaterial(0);
    const beam = makePlumeMaterial(1, new THREE.Color("#3ff2d0"));
    // The old shader literal was vec3(0.0, 0.85, 1.0); the default must equal it.
    const c = engine.uniforms.uColor.value as THREE.Color;
    expect([c.r, c.g, c.b]).toEqual([0, 0.85, 1]);
    expect((beam.uniforms.uColor.value as THREE.Color).getHexString()).toBe("3ff2d0");
    // Same source => three.js reuses one program for both (no new program).
    expect(beam.fragmentShader).toBe(engine.fragmentShader);
    expect(beam.vertexShader).toBe(engine.vertexShader);
  });
});

describe("makeBeamGeometry", () => {
  it("is a point at the nose (y=0) and the full radius at the far end (y=-1)", () => {
    const pos = makeBeamGeometry().attributes.position;
    let nose = 0, far = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if (Math.abs(pos.getY(i)) < 1e-6) nose = Math.max(nose, r);
      if (Math.abs(pos.getY(i) + 1) < 1e-6) far = Math.max(far, r);
    }
    // Exactly a point: an open apex ring reads as a dark disc from the chase camera.
    expect(nose).toBe(0);
    expect(far).toBeCloseTo(1, 5);
  });
});

describe("vacuum plume (L31)", () => {
  const R = 0.07;
  it("is a plain tube; the shader does the fanning", () => {
    const p = makePlumeGeometry(R).attributes.position;
    for (let i = 0; i < p.count; i++) expect(Math.hypot(p.getX(i), p.getZ(i))).toBeCloseTo(R, 6);
  });
  it("fans out at about 30 degrees half-angle at idle, cruise and warp lengths", () => {
    expect(PLUME_HALF_ANGLE_DEG).toBe(30);
    for (const len of [0.35, 1.7, 3.7]) {
      const tip = R * (1 + plumeSpreadFor(len, R, PLUME_HALF_ANGLE_DEG)); // tip radius, world
      const deg = (Math.atan((tip - R) / len) * 180) / Math.PI;
      expect(Math.abs(deg - 30)).toBeLessThan(1);
    }
  });
  it("widens the tube in the vertex shader and thins it as it widens", () => {
    const m = makePlumeMaterial(0);
    expect(m.vertexShader).toMatch(/uSpread/);
    expect(m.fragmentShader).toMatch(/vWiden/);
    expect(m.uniforms.uSpread.value).toBe(0);
  });
  it("the tractor beam's material does not widen (uSpread 0)", () => {
    expect(makePlumeMaterial(4.2, new THREE.Color("#3ff2d0")).uniforms.uSpread.value).toBe(0);
  });
  it("keeps the same triangle count", () => {
    expect(makePlumeGeometry(0.07).index!.count).toBe(20 * 12 * 6);
  });
  // The probes' relocation burn leaves its engine bell visible at the plume's
  // root (uRoot > 0); every other plume keeps its root at full (uRoot 0), the
  // same program either way.
  it("can fade the plume's root in over uRoot of its length, off (0) by default", () => {
    const m = makePlumeMaterial(0);
    expect(m.uniforms.uRoot.value).toBe(0);
    expect(m.fragmentShader).toMatch(/uniform float uRoot;/);
    expect(m.fragmentShader).toMatch(/plumeRoot\( t, uRoot \)/);
    for (const t of [0, 0.01, 0.5, 1]) expect(plumeRootFade(t, 0)).toBe(1);
    expect(plumeRootFade(0, 0.1)).toBe(0);
    expect(plumeRootFade(0.05, 0.1)).toBeCloseTo(0.5, 6);
    expect(plumeRootFade(0.1, 0.1)).toBe(1);
    expect(plumeRootFade(0.7, 0.1)).toBe(1);
  });
  it("has no shock diamonds (they need an atmosphere)", () => {
    const f = makePlumeMaterial(0).fragmentShader;
    expect(f).not.toMatch(/diamond/i);
    expect(f).not.toMatch(/sin\(t \*/);
  });
});
