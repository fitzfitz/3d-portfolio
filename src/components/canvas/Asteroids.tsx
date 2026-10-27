import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useModel } from "../../utils/sceneAssets";
import { asteroidInstances, ASTEROID_COLLIDERS } from "../../data/asteroids";
import { setScannable } from "../../utils/scannables";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { asteroidVariants } from "./asteroidVariants";

const VARIANTS = 4;
const dummy = new THREE.Object3D();

// Instances grouped by sculpted variant — one InstancedMesh per variant.
const byVariant = Array.from({ length: VARIANTS }, (_, v) =>
  asteroidInstances.filter((a) => a.variant === v)
);

export default function Asteroids() {
  const { scene } = useModel(assetUrl("/models/asteroids.glb"));
  const gl = useThree((s) => s.gl);
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([null, null, null, null]);

  // Each variant's geometry and material (asteroidVariants.ts; the Nest's rocks share them).
  const variants = useMemo(() => asteroidVariants(scene), [scene]);

  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const { material } of variants) {
      for (const tex of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
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
    const time = ambientTime(state.clock.getElapsedTime());
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
