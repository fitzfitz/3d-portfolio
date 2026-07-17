import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

interface AsteroidData {
  position: [number, number, number];
  scale: number;
  rotationSpeed: [number, number, number];
  initialRotation: [number, number, number];
}

const asteroidInstances: AsteroidData[] = [
  { position: [-40, -5, -60], scale: 1.5, rotationSpeed: [0.08, 0.05, 0.03], initialRotation: [0.2, 0.5, 0.1] },
  { position: [60, 2, 70], scale: 2.2, rotationSpeed: [-0.05, 0.08, 0.04], initialRotation: [1.2, 0.2, 0.5] },
  { position: [-90, -10, -20], scale: 1.2, rotationSpeed: [0.04, -0.06, 0.08], initialRotation: [0.5, 1.1, 0.2] },
  { position: [80, 5, -120], scale: 2.8, rotationSpeed: [0.03, 0.04, -0.05], initialRotation: [0.8, 0.3, 0.9] },
  { position: [-160, 3, 20], scale: 3.5, rotationSpeed: [-0.04, 0.03, 0.06], initialRotation: [2.1, 0.4, 0.2] },
  { position: [110, -8, 120], scale: 1.8, rotationSpeed: [0.06, -0.08, 0.03], initialRotation: [0.4, 1.8, 0.6] },
  { position: [-30, 6, 140], scale: 2.0, rotationSpeed: [0.05, 0.05, -0.04], initialRotation: [0.9, 0.9, 0.1] },
  { position: [140, -4, 40], scale: 1.4, rotationSpeed: [-0.03, 0.04, 0.07], initialRotation: [1.5, 0.2, 1.2] },
  { position: [-70, 0, -170], scale: 2.5, rotationSpeed: [0.07, -0.03, 0.05], initialRotation: [0.1, 0.5, 1.8] },
  { position: [40, -2, -190], scale: 3.0, rotationSpeed: [-0.06, 0.06, -0.03], initialRotation: [0.5, 2.2, 0.4] },
  { position: [-200, 4, -80], scale: 2.4, rotationSpeed: [0.04, 0.05, 0.08], initialRotation: [1.8, 0.1, 0.5] },
  { position: [210, -6, -30], scale: 1.6, rotationSpeed: [-0.05, -0.04, 0.05], initialRotation: [0.3, 0.8, 1.1] },
];

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

  return <instancedMesh ref={meshRef} args={[geometry, material, COUNT]} frustumCulled={false} />;
}
