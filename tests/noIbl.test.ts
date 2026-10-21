import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { noIbl } from "../src/components/canvas/noIbl";

describe("the bodies take no image-based light (L29)", () => {
  it("points each material at the scene's own environment, at intensity 0", () => {
    const env = new THREE.CubeTexture();
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    noIbl([a, b], env);
    for (const m of [a, b]) {
      // The same texture as scene.environment: the same shader program, but
      // three now reads the material's envMapIntensity instead of the scene's.
      expect(m.envMap).toBe(env);
      expect(m.envMapIntensity).toBe(0);
    }
  });
  it("follows the environment when it arrives or changes, and leaves none while there is none", () => {
    const m = new THREE.MeshStandardMaterial();
    noIbl([m], null);
    expect(m.envMap).toBeNull();
    const first = new THREE.CubeTexture();
    noIbl([m], first);
    expect(m.envMap).toBe(first);
    const second = new THREE.CubeTexture();
    noIbl([m], second);
    expect(m.envMap).toBe(second);
    expect(m.envMapIntensity).toBe(0);
  });
  it("does not bump the material's version (no recompile, no uniform churn) once pinned", () => {
    const env = new THREE.CubeTexture();
    const m = new THREE.MeshStandardMaterial();
    noIbl([m], env);
    const v = m.version;
    noIbl([m], env);
    expect(m.version).toBe(v);
  });
});
