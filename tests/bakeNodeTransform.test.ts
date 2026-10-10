import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { bakeNodeTransform } from "../src/utils/bakeNodeTransform";

/** A mesh shaped like gltf-transform's quantize() output: positions stored as
 *  normalized Int16 in [-1, 1], with the real scale/offset on the node. */
function quantizedMesh() {
  const g = new THREE.BufferGeometry();
  // Two vertices at the quantized extremes, plus a normal.
  const pos = new THREE.BufferAttribute(new Int16Array([0, 32767, 0, 0, -32767, 0]), 3, true);
  const nrm = new THREE.BufferAttribute(new Int8Array([0, 127, 0, 0, -127, 0]), 3, true);
  g.setAttribute("position", pos);
  g.setAttribute("normal", nrm);
  const mesh = new THREE.Mesh(g);
  mesh.position.set(0, -1.74, 0);
  mesh.scale.setScalar(2.46);
  return mesh;
}

describe("bakeNodeTransform", () => {
  it("restores authored extents beyond [-1, 1] instead of clamping them", () => {
    const g = bakeNodeTransform(quantizedMesh());
    const p = g.getAttribute("position");
    expect(p.getY(0)).toBeCloseTo(0.72, 2);   // -1.74 + 2.46
    expect(p.getY(1)).toBeCloseTo(-4.2, 2);   // -1.74 - 2.46 — clamped to -1 before the fix
  });

  it("produces float attributes and unit normals", () => {
    const g = bakeNodeTransform(quantizedMesh());
    expect(g.getAttribute("position").array).toBeInstanceOf(Float32Array);
    expect(g.getAttribute("normal").array).toBeInstanceOf(Float32Array);
    expect(Math.abs(g.getAttribute("normal").getY(0))).toBeCloseTo(1, 3);
  });

  it("does not mutate the source mesh's geometry", () => {
    const m = quantizedMesh();
    bakeNodeTransform(m);
    expect(m.geometry.getAttribute("position").array).toBeInstanceOf(Int16Array);
  });
});
