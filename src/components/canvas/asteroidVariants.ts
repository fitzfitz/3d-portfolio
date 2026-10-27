import * as THREE from "three";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";

const VARIANTS = 4;

/**
 * Each sculpted variant's geometry and material from asteroids.glb, by
 * variant (0 boulder, 1 shard, 2 contact binary, 3 rubble chunk), for the
 * scenery asteroids (Asteroids.tsx). Quantized GLBs store the
 * dequantization transform on the node matrix: it is baked into a geometry
 * clone so instancing matrices stay pure position/rotation/scale. The
 * caller owns (and disposes) the geometry and material clones; the maps are
 * the model's, shared.
 */
export function asteroidVariants(scene: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[] {
  const found: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[] = [];
  for (let v = 0; v < VARIANTS; v++) {
    let mesh: THREE.Mesh | undefined;
    scene.traverse((o) => {
      if (!mesh && o instanceof THREE.Mesh && o.name.startsWith(`Asteroid${v}`)) mesh = o;
    });
    if (!mesh) throw new Error(`asteroids.glb is missing mesh Asteroid${v}`);
    // Float-safe and recentred. The four variants sit side by side in the
    // GLB (node x up to ±4.5); baking that offset straight into the
    // quantized [-1, 1] storage clamped every rock into a flat slab, and
    // even un-clamped it would pivot each rock 4.5u off its collider.
    const geometry = bakeNodeTransform(mesh, { center: true });
    const material = (mesh.material as THREE.MeshStandardMaterial).clone();
    // Slightly glossier than the baked default so tumbling facets catch
    // the sun — the "glint" is free specular from sharp facet normals.
    material.roughness = 0.72;
    material.metalness = 0.15;
    found.push({ geometry, material });
  }
  return found;
}
