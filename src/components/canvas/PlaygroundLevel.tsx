import { useRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import HeroNodeNetwork from "./HeroNodeNetwork";
import PortalRing from "./PortalRing";

interface ObstacleBox {
  id: number;
  name: string;
  color: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Vector3;
}

interface PlaygroundLevelProps {
  vehiclePos: { x: number; z: number };
  onSpawnMarble: (pt: THREE.Vector3) => void;
  onZoneOverlay: (zone: string | null) => void;
}

export default function PlaygroundLevel({
  vehiclePos,
  onSpawnMarble,
  onZoneOverlay,
}: PlaygroundLevelProps) {
  const floorRef = useRef<THREE.Mesh>(null);

  // Proximity checkpoints
  const zones = useMemo(
    () => [
      { name: "projects", pos: new THREE.Vector2(-6, 6), radius: 2.2 },
      { name: "skills", pos: new THREE.Vector2(6, -6), radius: 2.2 },
      { name: "contact", pos: new THREE.Vector2(0, -10), radius: 2.0 },
    ],
    []
  );

  // Stack of rammable skills blocks (pyramid stack at Skills zone)
  const [blocks, setBlocks] = useState<ObstacleBox[]>(() => {
    const list: ObstacleBox[] = [];
    const techSkills = ["React", "Vite", "TS", "Hono", "Postgres", "Docker", "Agents"];
    const colors = ["#00ff87", "#00f0ff", "#bd00ff", "#ec4899"];

    let count = 0;
    // Layer 1 (Ground)
    for (let i = -1.2; i <= 1.2; i += 0.8) {
      list.push({
        id: count,
        name: techSkills[count % techSkills.length],
        color: colors[count % colors.length],
        position: new THREE.Vector3(6 + i, 0.25, -3.5),
        velocity: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Vector3(0, (Math.random() - 0.5) * 0.2, 0),
      });
      count++;
    }
    // Layer 2
    for (let i = -0.8; i <= 0.8; i += 0.8) {
      list.push({
        id: count,
        name: techSkills[count % techSkills.length],
        color: colors[count % colors.length],
        position: new THREE.Vector3(6 + i, 0.75, -3.5),
        velocity: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Vector3(0, (Math.random() - 0.5) * 0.2, 0),
      });
      count++;
    }
    // Layer 3 (Top)
    list.push({
      id: count,
      name: techSkills[count % techSkills.length],
      color: colors[count % colors.length],
      position: new THREE.Vector3(6, 1.25, -3.5),
      velocity: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Vector3(0, 0, 0),
    });

    return list;
  });

  useFrame(() => {
    // 1. Proximity zone check
    const currentPos = new THREE.Vector2(vehiclePos.x, vehiclePos.z);
    let activeZone: string | null = null;
    
    for (const zone of zones) {
      if (currentPos.distanceTo(zone.pos) < zone.radius) {
        activeZone = zone.name;
        break;
      }
    }
    onZoneOverlay(activeZone);

    // 2. Simple block-vehicle push collisions & physics simulation
    setBlocks((prevBlocks) => {
      const vPos = new THREE.Vector3(vehiclePos.x, 0.25, vehiclePos.z);

      return prevBlocks.map((b) => {
        const nextPos = b.position.clone();
        const nextVel = b.velocity.clone();
        const nextRot = b.rotation.clone();

        // Distance from block to player vehicle
        const dist = nextPos.distanceTo(vPos);
        const radiusSum = 0.75; // Bounding cylinders overlap checking

        if (dist < radiusSum) {
          // Push vector away from player
          const dir = new THREE.Vector3().subVectors(nextPos, vPos);
          dir.y = 0; // lock to horizontal plane
          dir.normalize();

          // Apply kinetic shock force inversely proportional to distance
          const force = (radiusSum - dist) * 0.4;
          nextVel.addScaledVector(dir, force + 0.15);

          // Add a rotation spin
          nextRot.y += (Math.random() - 0.5) * 0.5;
          nextRot.x += (Math.random() - 0.5) * 0.2;
        }

        // Apply friction to slow down moving blocks
        nextVel.multiplyScalar(0.9);

        // Gravity fallback if launched
        if (nextPos.y > 0.25) {
          nextVel.y -= 0.01;
        }

        // Add velocity to position
        nextPos.add(nextVel);

        // Floor collision limits
        if (nextPos.y <= 0.25) {
          nextPos.y = 0.25;
          nextVel.y = 0;
        }

        // Lock within boundaries
        nextPos.x = Math.max(-18, Math.min(18, nextPos.x));
        nextPos.z = Math.max(-18, Math.min(18, nextPos.z));

        return {
          ...b,
          position: nextPos,
          velocity: nextVel,
          rotation: nextRot,
        };
      });
    });
  });

  // Handle spawn marble click
  const handleGroundClick = (e: any) => {
    e.stopPropagation();
    if (e.point) {
      onSpawnMarble(new THREE.Vector3(e.point.x, e.point.y, e.point.z));
    }
  };

  return (
    <group>
      {/* 1. Cyberpunk grid helper */}
      <gridHelper args={[40, 40, "#00ff87", "#17152b"]} position={[0, 0.02, 0]} />

      {/* 2. Interactive Floor mesh to capture mouse clicks */}
      <mesh
        ref={floorRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerDown={handleGroundClick}
        receiveShadow={true}
      >
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#080711" roughness={0.9} metalness={0.2} />
      </mesh>

      {/* Outer arena glowing fences */}
      <mesh position={[0, 0.4, 20]}>
        <boxGeometry args={[40, 0.8, 0.1]} />
        <meshStandardMaterial color="#00ff87" emissive="#00ff87" emissiveIntensity={0.2} transparent={true} opacity={0.3} />
      </mesh>
      <mesh position={[0, 0.4, -20]}>
        <boxGeometry args={[40, 0.8, 0.1]} />
        <meshStandardMaterial color="#00ff87" emissive="#00ff87" emissiveIntensity={0.2} transparent={true} opacity={0.3} />
      </mesh>
      <mesh position={[20, 0.4, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[40, 0.8, 0.1]} />
        <meshStandardMaterial color="#00ff87" emissive="#00ff87" emissiveIntensity={0.2} transparent={true} opacity={0.3} />
      </mesh>
      <mesh position={[-20, 0.4, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[40, 0.8, 0.1]} />
        <meshStandardMaterial color="#00ff87" emissive="#00ff87" emissiveIntensity={0.2} transparent={true} opacity={0.3} />
      </mesh>

      {/* 3. HERO SPARKLES NODE AREA (y = 0.5, center) */}
      <group position={[0, 0.8, 0]} scale={0.7}>
        <HeroNodeNetwork />
      </group>

      {/* 4. PROJECTS CHECKPOINT ZONE (pos: -6, 6) */}
      <group position={[-6, 0.05, 6]}>
        {/* Glow indicator ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.8, 2.0, 32]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.8} />
        </mesh>
        {/* Dock billboard stand */}
        <mesh position={[0, 0.8, -0.2]}>
          <boxGeometry args={[2.5, 1.6, 0.1]} />
          <meshPhysicalMaterial
            color="#00f0ff"
            transmission={0.6}
            opacity={0.4}
            transparent={true}
            roughness={0.1}
          />
        </mesh>
        {/* Text/Glow border */}
        <lineSegments position={[0, 0.8, -0.2]}>
          <edgesGeometry args={[new THREE.BoxGeometry(2.5, 1.6, 0.1)]} />
          <lineBasicMaterial color="#00f0ff" linewidth={2} />
        </lineSegments>
      </group>

      {/* 5. SKILLS ZONE & JUMP RAMP (pos: 6, -6) */}
      <group position={[6, 0.05, -6]}>
        {/* Zone indicator ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.8, 2.0, 32]} />
          <meshBasicMaterial color="#00ff87" transparent={true} opacity={0.8} />
        </mesh>
      </group>

      {/* Neon Launch Ramp (slanted prism) */}
      <group position={[6, 0, -2]} rotation={[0, 0, 0]}>
        <mesh position={[0, 0.25, 0.5]} rotation={[-0.3, 0, 0]}>
          <boxGeometry args={[2.0, 0.08, 1.8]} />
          <meshStandardMaterial color="#00ff87" emissive="#00ff87" emissiveIntensity={0.6} roughness={0.1} />
        </mesh>
        {/* Supporting frame */}
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[2.0, 0.2, 0.1]} />
          <meshStandardMaterial color="#222230" />
        </mesh>
      </group>

      {/* Rammable Skills pyramid block models */}
      {blocks.map((b) => (
        <mesh
          key={b.id}
          position={b.position}
          rotation={[b.rotation.x, b.rotation.y, b.rotation.z]}
          castShadow={true}
        >
          <boxGeometry args={[0.7, 0.45, 0.7]} />
          <meshStandardMaterial
            color={b.color}
            emissive={b.color}
            emissiveIntensity={0.3}
            roughness={0.3}
            metalness={0.1}
          />
        </mesh>
      ))}

      {/* 6. CONTACT ZONE WORMHOLE PORTAL (pos: 0, -10) */}
      <group position={[0, 0.05, -10]}>
        {/* Zone ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.8, 2.0, 32]} />
          <meshBasicMaterial color="#bd00ff" transparent={true} opacity={0.8} />
        </mesh>
        {/* Floating portal core */}
        <group position={[0, 1.4, 0]} scale={0.7}>
          <PortalRing />
        </group>
      </group>

    </group>
  );
}
