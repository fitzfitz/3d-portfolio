import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { makePlumeMaterial, makeBeamGeometry } from "../src/components/canvas/enginePlume";

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
    expect(nose).toBeLessThan(0.05);
    expect(far).toBeCloseTo(1, 5);
  });
});
