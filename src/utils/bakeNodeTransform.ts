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
 *
 * `world` bakes the mesh's world matrix instead of its own: GLTFLoader loads
 * a node holding a multi-primitive mesh as a Group (carrying the node's
 * transform, the quantization scale and offset included) of one Mesh per
 * primitive whose own matrix is identity (the space monsters' LOD nodes).
 */
export function bakeNodeTransform(mesh: THREE.Mesh, { center = false, world = false } = {}): THREE.BufferGeometry {
  mesh.updateMatrix();
  if (world) mesh.updateWorldMatrix(true, false);
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
  g.applyMatrix4(world ? mesh.matrixWorld : mesh.matrix);
  // Generators often lay variants out side by side for previews (asteroids at
  // x = -4.5 .. +4.5); an instanced/placed copy should pivot on its own body.
  if (center) g.center();
  return g;
}
