import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { asteroidInstances } from "../../data/asteroids";

const COUNT = asteroidInstances.length;
const dummy = new THREE.Object3D();

export default function Asteroids() {
  const { scene } = useGLTF("/models/asteroid.glb");
  const gl = useThree((s) => s.gl);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Pull the single mesh's geometry+material out of the GLB
  const { geometry, material } = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    let m: THREE.Material | undefined;
    scene.traverse((c) => {
      if (!g && c instanceof THREE.Mesh) { g = c.geometry; m = c.material as THREE.Material; }
    });
    if (!g || !m) throw new Error("asteroid.glb contains no mesh");
    return { geometry: g, material: m };
  }, [scene]);

  // Sharper texture sampling at grazing angles — effectively free
  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    const mat = material as THREE.MeshStandardMaterial;
    for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) {
      if (tex) { tex.anisotropy = maxAniso; tex.needsUpdate = true; }
    }
  }, [material, gl]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.getElapsedTime();
    for (let i = 0; i < COUNT; i++) {
      const d = asteroidInstances[i];
      dummy.position.set(...d.position);
      dummy.rotation.set(
        d.initialRotation[0] + time * d.rotationSpeed[0],
        d.initialRotation[1] + time * d.rotationSpeed[1],
        d.initialRotation[2] + time * d.rotationSpeed[2],
      );
      dummy.scale.setScalar(d.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, COUNT]} frustumCulled={false} dispose={null} />;
}
