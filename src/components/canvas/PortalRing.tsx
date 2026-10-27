import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ambientTime } from "../../utils/ambientTime";
import { glowScale } from "../../utils/sunLight";

/** The portal light blends between these by its two flickers' ratio. */
const PORTAL_RED = new THREE.Color("#ff3300");
const PORTAL_AMBER = new THREE.Color("#ffaa00");
/** The rings' emissive gains and the particles' colour at 1 AU; written × glowScale each frame. */
const OUTER_GLOW = 2.5;
const INNER_GLOW = 3.0;
const PARTICLE_COLOR = new THREE.Color("#ff6600");

export default function PortalRing() {
  const outerRingRef = useRef<THREE.Mesh>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const particleGroupRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const outerMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const innerMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const particleMatRef = useRef<THREE.PointsMaterial>(null);

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

    // The rings and the swarm are self-lit: held at their 1 AU glow far out.
    // The light is not scaled (lights never are).
    const g = glowScale.value;
    if (outerMatRef.current) outerMatRef.current.emissiveIntensity = OUTER_GLOW * g;
    if (innerMatRef.current) innerMatRef.current.emissiveIntensity = INNER_GLOW * g;
    if (particleMatRef.current) particleMatRef.current.color.copy(PARTICLE_COLOR).multiplyScalar(g);

    // Light flicker. These two were the only entirely static parts of an
    // otherwise elaborately animated wormhole — the rings, aura, membrane and
    // core all pulse, while the light *sources* sat at fixed intensity, which
    // flattened the whole effect. Two incommensurate frequencies per light
    // (11/23 and 13/27) so they never settle into a visible repeating beat.
    //
    // One light now carries both flickers: their summed intensity, and a
    // colour blended red->amber by their ratio, so the shimmer survives at
    // half the cost (every lit fragment in the scene loops over every light).
    if (lightRef.current) {
      const a = 2.5 + Math.sin(time * 11) * 1.4 + Math.sin(time * 23) * 0.72;
      // Baseline 1.68 so this swing cannot go negative.
      const b = 1.68 + Math.sin(time * 13 + 1.7) * 1.2 + Math.sin(time * 27) * 0.48;
      lightRef.current.intensity = a + b;
      lightRef.current.color.lerpColors(PORTAL_RED, PORTAL_AMBER, b / (a + b));
    }
  });

  return (
    <group>
      {/* Lights inside the portal */}
      <pointLight ref={lightRef} color="#ff3300" intensity={4} distance={5} />

      {/* Outer Torus Ring */}
      <mesh ref={outerRingRef}>
        <torusGeometry args={[1.5, 0.05, 16, 100]} />
        <meshStandardMaterial
          ref={outerMatRef}
          color="#ff3300"
          emissive="#ff3300"
          emissiveIntensity={OUTER_GLOW}
          wireframe={true}
        />
      </mesh>

      {/* Inner Torus Ring */}
      <mesh ref={innerRingRef} scale={0.88}>
        <torusGeometry args={[1.4, 0.03, 12, 80]} />
        <meshStandardMaterial
          ref={innerMatRef}
          color="#ffaa00"
          emissive="#ffaa00"
          emissiveIntensity={INNER_GLOW}
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
            ref={particleMatRef}
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
