import { useRef, useImperativeHandle, forwardRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

interface Anomaly {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: string;
}

export interface AnomaliesRef {
  spawn: (point: THREE.Vector3) => void;
}

const colors = ["#00f0ff", "#bd00ff", "#ec4899", "#00ff87"];

interface AnomalyInstanceProps {
  a: Anomaly;
  scene: THREE.Group;
}

function AnomalyInstance({ a, scene }: AnomalyInstanceProps) {
  // Clone the scene only once per component mount (prevents memory leak)
  const cloned = useMemo(() => {
    const cl = scene.clone();
    cl.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        // Ensure the mesh has a valid material clone before modifying it
        const originalMat = child.material;
        const newMat = Array.isArray(originalMat) 
          ? originalMat.map(m => m.clone()) 
          : originalMat.clone();
        
        child.material = newMat;
        const targetMat = Array.isArray(newMat) ? newMat[0] : newMat;
        
        if (targetMat.emissive) {
          // Dynamic emissive tint matching the randomized spawn colors
          targetMat.emissive = new THREE.Color(a.color);
          targetMat.emissiveIntensity = 3.6; // High intensity for bloom
        } else {
          // If no emissive properties, apply basic glowing material
          child.material = new THREE.MeshBasicMaterial({
            color: a.color,
            transparent: true,
            opacity: 0.85,
          });
        }
      }
    });
    return cl;
  }, [scene, a.color]);

  const localRef = useRef<THREE.Group>(null);

  // Slow orbital rotation for individual crystals
  useFrame((state) => {
    if (localRef.current) {
      localRef.current.rotation.y = state.clock.getElapsedTime() * 1.4 + a.id;
    }
  });

  return (
    <group position={[a.position.x, a.position.y, a.position.z]} ref={localRef}>
      <primitive object={cloned} scale={0.55} rotation={[0.15, 0, 0]} />
      <pointLight color={a.color} intensity={0.9} distance={1.8} />
    </group>
  );
}

interface PlasmaAnomaliesProps {
  vehiclePos: { x: number; z: number };
}

export const PlasmaAnomalies = forwardRef<AnomaliesRef, PlasmaAnomaliesProps>(
  ({ vehiclePos }, ref) => {
    const { scene } = useGLTF("/models/space_crystal.glb");
    const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
    const nextId = useRef(0);

    // Expose spawn method
    useImperativeHandle(ref, () => ({
      spawn(point: THREE.Vector3) {
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const newAnomaly: Anomaly = {
          id: nextId.current++,
          position: new THREE.Vector3(point.x, (Math.random() - 0.5) * 0.5, point.z),
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 0.015,
            (Math.random() - 0.5) * 0.005,
            (Math.random() - 0.5) * 0.015
          ),
          color: randomColor,
        };
        
        // Limit to 40 active anomalies
        setAnomalies((prev) => [...prev.slice(-39), newAnomaly]);
      },
    }));

    useFrame(() => {
      if (anomalies.length === 0) return;

      const shipPosVec = new THREE.Vector3(vehiclePos.x, 0, vehiclePos.z);

      setAnomalies((currentAnomalies) => {
        // Map and filter out absorbed ones
        return currentMarblesFiltered(currentAnomalies, shipPosVec);
      });
    });

    // Helper update loop
    function currentMarblesFiltered(list: Anomaly[], shipPosVec: THREE.Vector3): Anomaly[] {
      const results: Anomaly[] = [];

      for (const m of list) {
        const nextPos = m.position.clone();
        const nextVel = m.velocity.clone();

        // 1. Distance checking to spaceship
        const dist = nextPos.distanceTo(shipPosVec);

        // If absorbed, skip adding to output list (disappears)
        if (dist < 0.4) {
          continue;
        }

        // 2. Gravitational pull toward spaceship core if close enough (< 4.5 units)
        if (dist < 4.5) {
          const dir = new THREE.Vector3().subVectors(shipPosVec, nextPos).normalize();
          // Magnetic suction force increases as distance decreases
          const pull = (1.0 - dist / 4.5) * 0.003;
          nextVel.addScaledVector(dir, pull);
        }

        // 3. Move particle
        nextPos.add(nextVel);

        // Air drag in magnetic fields
        nextVel.multiplyScalar(0.985);

        // Boundary reflection checking
        const limit = 26;
        if (Math.abs(nextPos.x) >= limit) {
          nextPos.x = Math.sign(nextPos.x) * limit;
          nextVel.x = -nextVel.x * 0.8;
        }
        if (Math.abs(nextPos.z) >= limit) {
          nextPos.z = Math.sign(nextPos.z) * limit;
          nextVel.z = -nextVel.z * 0.8;
        }

        results.push({
          ...m,
          position: nextPos,
          velocity: nextVel,
        });
      }

      return results;
    }

    return (
      <group>
        {anomalies.map((a) => (
          <AnomalyInstance key={a.id} a={a} scene={scene} />
        ))}
      </group>
    );
  }
);

PlasmaAnomalies.displayName = "PlasmaAnomalies";
