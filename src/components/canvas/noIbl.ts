import type * as THREE from "three";

/**
 * The planets, the moons and the cloud shells are lit by the Sun and the
 * ambient fill only (L29: one light source). The studio environment in
 * GlobalCanvas.tsx, the IBL that gives the ship and the small props their
 * reflections, is a few coloured panels fixed in world space; on a body it
 * lit one side orange and another cyan wherever the Sun was, which read as a
 * faint red glow on the night sides.
 *
 * three lights a standard material whose own `envMap` is null with
 * `scene.environment` at `scene.environmentIntensity`, and ignores the
 * material's `envMapIntensity`. So each body material points `envMap` at
 * that same environment texture, which keeps its shader program the same
 * (no new program), and takes `envMapIntensity` 0. drei's `<Environment>`
 * sets the texture after the bodies mount, so this runs every frame; it
 * writes only on a change. Allocation-free.
 */
export function noIbl(materials: readonly THREE.MeshStandardMaterial[], environment: THREE.Texture | null): void {
  for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    if (m.envMap !== environment) m.envMap = environment;
    m.envMapIntensity = 0;
  }
}
