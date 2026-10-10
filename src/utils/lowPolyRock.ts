import * as THREE from "three";

/**
 * A cheap rock for the asteroid belt: a detail-1 icosahedron (80 triangles)
 * with each vertex pushed in or out by up to `roughness` of the radius.
 *
 * The icosahedron is non-indexed, so a shared corner exists once per face that
 * touches it. Displacement is a hash of the vertex's *original position*, not
 * its index, so every copy of a corner moves identically and the mesh stays
 * watertight. Normals are recomputed flat, which reads as chipped stone.
 */
export function lowPolyRock(radius: number, seed: number, roughness = 0.22): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + (hash3(x / radius, y / radius, z / radius, seed) * 2 - 1) * roughness;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Deterministic 0..1 hash of a (rounded) direction and a seed. */
function hash3(x: number, y: number, z: number, seed: number): number {
  const q = (v: number) => Math.round(v * 1e4);
  let h = (q(x) * 73856093) ^ (q(y) * 19349663) ^ (q(z) * 83492791) ^ Math.imul(seed + 1, 2654435761);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
