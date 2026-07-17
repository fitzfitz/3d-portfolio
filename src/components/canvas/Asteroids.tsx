import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

interface AsteroidData {
  id: number;
  position: [number, number, number];
  scale: number;
  rotationSpeed: [number, number, number];
  initialRotation: [number, number, number];
}

const asteroidInstances: AsteroidData[] = [
  { id: 1, position: [-40, -5, -60], scale: 1.5, rotationSpeed: [0.08, 0.05, 0.03], initialRotation: [0.2, 0.5, 0.1] },
  { id: 2, position: [60, 2, 70], scale: 2.2, rotationSpeed: [-0.05, 0.08, 0.04], initialRotation: [1.2, 0.2, 0.5] },
  { id: 3, position: [-90, -10, -20], scale: 1.2, rotationSpeed: [0.04, -0.06, 0.08], initialRotation: [0.5, 1.1, 0.2] },
  { id: 4, position: [80, 5, -120], scale: 2.8, rotationSpeed: [0.03, 0.04, -0.05], initialRotation: [0.8, 0.3, 0.9] },
  { id: 5, position: [-160, 3, 20], scale: 3.5, rotationSpeed: [-0.04, 0.03, 0.06], initialRotation: [2.1, 0.4, 0.2] },
  { id: 6, position: [110, -8, 120], scale: 1.8, rotationSpeed: [0.06, -0.08, 0.03], initialRotation: [0.4, 1.8, 0.6] },
  { id: 7, position: [-30, 6, 140], scale: 2.0, rotationSpeed: [0.05, 0.05, -0.04], initialRotation: [0.9, 0.9, 0.1] },
  { id: 8, position: [140, -4, 40], scale: 1.4, rotationSpeed: [-0.03, 0.04, 0.07], initialRotation: [1.5, 0.2, 1.2] },
  { id: 9, position: [-70, 0, -170], scale: 2.5, rotationSpeed: [0.07, -0.03, 0.05], initialRotation: [0.1, 0.5, 1.8] },
  { id: 10, position: [40, -2, -190], scale: 3.0, rotationSpeed: [-0.06, 0.06, -0.03], initialRotation: [0.5, 2.2, 0.4] },
  { id: 11, position: [-200, 4, -80], scale: 2.4, rotationSpeed: [0.04, 0.05, 0.08], initialRotation: [1.8, 0.1, 0.5] },
  { id: 12, position: [210, -6, -30], scale: 1.6, rotationSpeed: [-0.05, -0.04, 0.05], initialRotation: [0.3, 0.8, 1.1] },
];

function AsteroidInstance({ data, scene }: { data: AsteroidData; scene: THREE.Group }) {
  // Clone the scene once on component mount to share materials and textures efficiently
  const cloned = useMemo(() => scene.clone(), [scene]);
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    if (ref.current) {
      ref.current.rotation.x = data.initialRotation[0] + time * data.rotationSpeed[0];
      ref.current.rotation.y = data.initialRotation[1] + time * data.rotationSpeed[1];
      ref.current.rotation.z = data.initialRotation[2] + time * data.rotationSpeed[2];
    }
  });

  return (
    <group position={data.position} ref={ref}>
      <primitive object={cloned} scale={data.scale} />
    </group>
  );
}

export default function Asteroids() {
  const { scene } = useGLTF("/models/asteroid.glb");
  
  return (
    <group>
      {asteroidInstances.map((data) => (
        <AsteroidInstance key={data.id} data={data} scene={scene} />
      ))}
    </group>
  );
}
