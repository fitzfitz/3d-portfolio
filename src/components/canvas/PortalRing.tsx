import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ambientTime } from "../../utils/ambientTime";
import { animScale } from "../../utils/animScale";

export default function PortalRing() {
  const outerRingRef = useRef<THREE.Mesh>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const particleGroupRef = useRef<THREE.Group>(null);
  const lightARef = useRef<THREE.PointLight>(null);
  const lightBRef = useRef<THREE.PointLight>(null);

  // Generate orbital particles around the portal
  const particleCount = 40;
  const positions = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.5;
      const radius = 1.6 + Math.random() * 0.4;
      
      pos[i * 3] = Math.sin(angle) * radius;
      pos[i * 3 + 1] = Math.cos(angle) * radius;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
    }
    return pos;
  }, []);

  useFrame((state) => {
    const time = ambientTime(state.clock.getElapsedTime());

    // Rotate the ring components in opposite directions
    if (outerRingRef.current) {
      outerRingRef.current.rotation.z = time * 0.2;
      outerRingRef.current.rotation.x = Math.sin(time * 0.4) * 0.15;
    }
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z = -time * 0.39;
      innerRingRef.current.rotation.y = Math.cos(time * 0.3) * 0.15;
    }

    // Swarm particles around the center
    if (particleGroupRef.current) {
      particleGroupRef.current.rotation.z = time * 0.1;
    }

    // Light flicker. These two were the only entirely static parts of an
    // otherwise elaborately animated wormhole — the rings, aura, membrane and
    // core all pulse, while the light *sources* sat at fixed intensity, which
    // flattened the whole effect. Two incommensurate frequencies per light
    // (11/23 and 13/27) so they never settle into a visible repeating beat.
    if (lightARef.current) {
      const k = animScale();
      lightARef.current.intensity = 2.5 + (Math.sin(time * 11) * 0.35 + Math.sin(time * 23) * 0.18) * k;
    }
    if (lightBRef.current) {
      lightBRef.current.intensity = 1.5 + (Math.sin(time * 13 + 1.7) * 0.3 + Math.sin(time * 27) * 0.12) * animScale();
    }
  });

  return (
    <group>
      {/* Lights inside the portal */}
      <pointLight ref={lightARef} color="#ff3300" intensity={2.5} distance={5} />
      <pointLight ref={lightBRef} color="#ffaa00" intensity={1.5} distance={5} />

      {/* Outer Torus Ring */}
      <mesh ref={outerRingRef}>
        <torusGeometry args={[1.5, 0.05, 16, 100]} />
        <meshStandardMaterial
          color="#ff3300"
          emissive="#ff3300"
          emissiveIntensity={2.5}
          wireframe={true}
        />
      </mesh>

      {/* Inner Torus Ring */}
      <mesh ref={innerRingRef} scale={0.88}>
        <torusGeometry args={[1.4, 0.03, 12, 80]} />
        <meshStandardMaterial
          color="#ffaa00"
          emissive="#ffaa00"
          emissiveIntensity={3.0}
          wireframe={true}
        />
      </mesh>

      {/* Portal Horizon Disk (looks like a wormhole portal core) */}
      <mesh rotation={[0, 0, 0]}>
        <ringGeometry args={[0, 1.2, 32]} />
        <meshBasicMaterial
          color="#140600"
          transparent={true}
          opacity={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Swarm of floating particles */}
      <group ref={particleGroupRef}>
        <points>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[positions, 3]}
              count={particleCount}
              array={positions}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial
            color="#ff6600"
            size={0.06}
            transparent={true}
            opacity={0.8}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </points>
      </group>
    </group>
  );
}
