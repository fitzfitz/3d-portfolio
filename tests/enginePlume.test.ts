import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { makePlumeMaterial } from "../src/components/canvas/enginePlume";

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
