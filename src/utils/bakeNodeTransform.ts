import * as THREE from "three";

/**
 * Clones a GLB mesh's geometry with its node transform baked in, in float
 * precision.
 *
 * scripts/optimize-assets.mjs quantizes positions to normalized 16-bit
 * integers in [-1, 1] and moves the real scale/offset onto the node
 * (KHR_mesh_quantization). Calling applyMatrix4 on that geometry directly
 * writes the transformed values back into the same normalized storage, which
 * cannot hold anything outside [-1, 1] — every baked model was silently
 * clamped into a unit box (the jellyfish rendered squashed to ~40% of its
 * height). Expanding the vertex attributes to Float32 first fixes that.
 */
export function bakeNodeTransform(mesh: THREE.Mesh): THREE.BufferGeometry {
  mesh.updateMatrix();
  const g = mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    if (a.array instanceof Float32Array && !a.normalized && !("isInterleavedBufferAttribute" in a)) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  g.applyMatrix4(mesh.matrix);
  return g;
}
