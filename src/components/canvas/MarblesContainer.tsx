import { useRef, useImperativeHandle, forwardRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Marble {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: string;
}

export interface MarblesRef {
  spawn: (point: THREE.Vector3) => void;
}

const colors = ["#00ff87", "#00f0ff", "#bd00ff", "#ec4899"];

export const MarblesContainer = forwardRef<MarblesRef, {}>((_, ref) => {
  const [marbles, setMarbles] = useState<Marble[]>([]);
  const nextId = useRef(0);

  // Expose spawn method to parent Scene container
  useImperativeHandle(ref, () => ({
    spawn(point: THREE.Vector3) {
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      const newMarble: Marble = {
        id: nextId.current++,
        position: new THREE.Vector3(point.x, Math.max(3.5, point.y + 3), point.z),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 0.05,
          -0.02,
          (Math.random() - 0.5) * 0.05
        ),
        color: randomColor,
      };
      
      // Limit to max 30 marbles to prevent memory clutter
      setMarbles((prev) => [...prev.slice(-29), newMarble]);
    },
  }));

  useFrame(() => {
    if (marbles.length === 0) return;

    setMarbles((currentMarbles) => {
      return currentMarbles.map((m) => {
        const nextPos = m.position.clone();
        const nextVel = m.velocity.clone();

        // 1. Apply gravity
        nextVel.y -= 0.008;

        // 2. Add velocity to position
        nextPos.add(nextVel);

        // 3. Elastic collision with the ground floor (y = 0.12)
        if (nextPos.y <= 0.12) {
          nextPos.y = 0.12;
          // Reflect Y velocity with bounce restitution damping
          nextVel.y = -nextVel.y * 0.58;
          // Apply sliding friction on ground contact
          nextVel.x *= 0.85;
          nextVel.z *= 0.85;
        }

        // 4. Elastic collisions with workspace borders (x: [-18, 18], z: [-18, 18])
        const boundaryLimit = 18;
        if (Math.abs(nextPos.x) >= boundaryLimit) {
          nextPos.x = Math.sign(nextPos.x) * boundaryLimit;
          nextVel.x = -nextVel.x * 0.7;
        }
        if (Math.abs(nextPos.z) >= boundaryLimit) {
          nextPos.z = Math.sign(nextPos.z) * boundaryLimit;
          nextVel.z = -nextVel.z * 0.7;
        }

        // Apply air resistance/friction
        nextVel.x *= 0.99;
        nextVel.z *= 0.99;

        return {
          ...m,
          position: nextPos,
          velocity: nextVel,
        };
      });
    });
  });

  return (
    <group>
      {marbles.map((m) => (
        <group key={m.id} position={[m.position.x, m.position.y, m.position.z]}>
          <mesh castShadow={true}>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial
              color={m.color}
              emissive={m.color}
              emissiveIntensity={0.6}
              roughness={0.1}
              metalness={0.8}
            />
          </mesh>
          <pointLight color={m.color} intensity={0.5} distance={1.2} />
        </group>
      ))}
    </group>
  );
});

MarblesContainer.displayName = "MarblesContainer";
