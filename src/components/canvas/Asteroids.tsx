import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { asteroidInstances, ASTEROID_COLLIDERS } from "../../data/asteroids";
import { setScannable } from "../../utils/scannables";

const VARIANTS = 4;
const dummy = new THREE.Object3D();

// Instances grouped by sculpted variant — one InstancedMesh per variant.
const byVariant = Array.from({ length: VARIANTS }, (_, v) =>
  asteroidInstances.filter((a) => a.variant === v)
);

export default function Asteroids() {
  const { scene } = useGLTF("/models/asteroids.glb");
  const gl = useThree((s) => s.gl);
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([null, null, null, null]);

  // Extract each variant's geometry+material. Quantized GLBs store the
  // dequantization transform on the node matrix — bake it into a geometry
  // clone so instancing matrices stay pure position/rotation/scale.
  const variants = useMemo(() => {
    const found: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    for (let v = 0; v < VARIANTS; v++) {
      let mesh: THREE.Mesh | undefined;
      scene.traverse((o) => {
        if (!mesh && o instanceof THREE.Mesh && o.name.startsWith(`Asteroid${v}`)) mesh = o;
      });
      if (!mesh) throw new Error(`asteroids.glb is missing mesh Asteroid${v}`);
      mesh.updateMatrix();
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrix);
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      // Slightly glossier than the baked default so tumbling facets catch
      // the sun — the "glint" is free specular from sharp facet normals.
      material.roughness = 0.72;
      material.metalness = 0.15;
      found.push({ geometry, material });
    }
    return found;
  }, [scene]);

  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const { material } of variants) {
      const mat = material as THREE.MeshStandardMaterial;
      for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) {
        if (tex) { tex.anisotropy = maxAniso; tex.needsUpdate = true; }
      }
    }
    return () => variants.forEach(({ geometry, material }) => { geometry.dispose(); material.dispose(); });
  }, [variants, gl]);

  // Register static scan targets once — asteroid positions never move.
  useEffect(() => {
    ASTEROID_COLLIDERS.forEach((c) => setScannable(c.id, c.x, c.y, c.z, c.id.toUpperCase()));
  }, []);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    for (let v = 0; v < VARIANTS; v++) {
      const mesh = meshRefs.current[v];
      if (!mesh) continue;
      const group = byVariant[v];
      for (let i = 0; i < group.length; i++) {
        const d = group[i];
        dummy.position.set(...d.position);
        dummy.rotation.set(
          d.initialRotation[0] + time * d.rotationSpeed[0],
          d.initialRotation[1] + time * d.rotationSpeed[1],
          d.initialRotation[2] + time * d.rotationSpeed[2],
        );
        dummy.scale.setScalar(d.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {variants.map(({ geometry, material }, v) => (
        <instancedMesh
          key={v}
          ref={(m) => { meshRefs.current[v] = m; }}
          args={[geometry, material, byVariant[v].length]}
          frustumCulled={false}
          dispose={null}
        />
      ))}
    </>
  );
}
