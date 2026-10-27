import * as THREE from "three";

/**
 * Each self-lit GLB material's own emissive intensity, captured the first time
 * the cached GLTF material is seen (it outlives a remount), so a frame loop can
 * write base × glowScale without compounding (as Spaceship's neonBase does).
 */
const glowBase = new WeakMap<THREE.Material, number>();

export type GlowMaterial = { mat: THREE.MeshStandardMaterial; base: number };

/**
 * The emissive materials under `root` whose names match `name`, each once,
 * with its base intensity. Allocates; call it from a useMemo, not per frame.
 */
export function collectGlowMaterials(root: THREE.Object3D, name: RegExp): GlowMaterial[] {
  const out: GlowMaterial[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat || seen.has(mat) || !mat.emissive || !name.test(mat.name)) continue;
      seen.add(mat);
      if (!glowBase.has(mat)) glowBase.set(mat, mat.emissiveIntensity);
      out.push({ mat, base: glowBase.get(mat)! });
    }
  });
  return out;
}

/** Writes each material's base × `k` (a uniform write: no recompile, no allocation). */
export function applyGlow(list: readonly GlowMaterial[], k: number): void {
  for (let i = 0; i < list.length; i++) list[i].mat.emissiveIntensity = list[i].base * k;
}
