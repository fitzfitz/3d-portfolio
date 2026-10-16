import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { makePlumeMaterial, makeBeamGeometry, makePlumeGeometry, PLUME_TIP_SPREAD } from "../src/components/canvas/enginePlume";

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

describe("vacuum plume (L31)", () => {
  const radiusAt = (g: THREE.BufferGeometry, y: number) => {
    const p = g.attributes.position; let r = 0;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - y) < 1e-6) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
    return r;
  };
  it("spreads toward the tip instead of tapering (no ambient pressure to hold it in)", () => {
    const g = makePlumeGeometry(0.07);
    expect(radiusAt(g, 0.5)).toBeCloseTo(0.07, 6);            // nozzle (top)
    expect(radiusAt(g, -0.5)).toBeCloseTo(0.07 * PLUME_TIP_SPREAD, 6); // tip
    expect(PLUME_TIP_SPREAD).toBeGreaterThanOrEqual(2);
  });
  it("keeps the same triangle count", () => {
    expect(makePlumeGeometry(0.07).index!.count).toBe(20 * 12 * 6);
  });
  it("has no shock diamonds (they need an atmosphere)", () => {
    const f = makePlumeMaterial(0).fragmentShader;
    expect(f).not.toMatch(/diamond/i);
    expect(f).not.toMatch(/sin\(t \*/);
  });
});
