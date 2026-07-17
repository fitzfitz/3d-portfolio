import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Project {
  title: string;
  description: string;
  color: string;
}

interface ProjectCarouselProps {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  projects: Project[];
}

export default function ProjectCarousel({
  activeIndex,
  setActiveIndex,
  projects,
}: ProjectCarouselProps) {
  const groupRef = useRef<THREE.Group>(null);
  const radius = 2.8;

  // Track target rotation for smooth transition
  const targetRotation = useRef(0);

  // Update target rotation when activeIndex changes
  // With 3 projects, each is separated by 120 degrees (2 * Math.PI / 3)
  const angleStep = (2 * Math.PI) / 3;
  targetRotation.current = -activeIndex * angleStep;

  useFrame(() => {
    if (!groupRef.current) return;
    
    // Smoothly lerp the carousel rotation toward the target rotation
    groupRef.current.rotation.y = THREE.MathUtils.lerp(
      groupRef.current.rotation.y,
      targetRotation.current,
      0.1
    );
  });

  return (
    <group position={[0, -0.2, 0]}>
      {/* Lights local to carousel scene */}
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={1.5} color="#ffffff" />
      
      <group ref={groupRef}>
        {projects.map((project, idx) => {
          const angle = idx * angleStep;
          const x = Math.sin(angle) * radius;
          const z = Math.cos(angle) * radius;

          return (
            <CarouselCard
              key={idx}
              project={project}
              position={[x, 0, z]}
              rotation={[0, angle, 0]}
              isActive={activeIndex === idx}
              onClick={() => setActiveIndex(idx)}
            />
          );
        })}
      </group>
    </group>
  );
}

interface CardProps {
  project: Project;
  position: [number, number, number];
  rotation: [number, number, number];
  isActive: boolean;
  onClick: () => void;
}

function CarouselCard({ project, position, rotation, isActive, onClick }: CardProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  // Scale animation inside render loop based on hover & active status
  useFrame((state) => {
    if (!meshRef.current) return;
    
    const targetScale = isActive ? 1.15 : hovered ? 1.05 : 0.95;
    meshRef.current.scale.setScalar(
      THREE.MathUtils.lerp(meshRef.current.scale.x, targetScale, 0.15)
    );

    // Subtle floating bobbing effect
    const time = state.clock.getElapsedTime();
    meshRef.current.position.y = Math.sin(time * 1.5 + position[0]) * 0.08;
  });

  return (
    <group position={position} rotation={rotation}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          document.body.style.cursor = "default";
        }}
      >
        {/* Main Card Plane */}
        <boxGeometry args={[1.8, 2.6, 0.08]} />
        <meshPhysicalMaterial
          color={project.color}
          transmission={0.55}
          opacity={isActive ? 0.9 : 0.45}
          transparent={true}
          roughness={0.2}
          metalness={0.1}
          clearcoat={1}
          clearcoatRoughness={0.1}
          thickness={1.2}
          side={THREE.DoubleSide}
        />
        
        {/* Neon Wireframe Border */}
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(1.8, 2.6, 0.08)]} />
          <lineBasicMaterial
            color={project.color}
            linewidth={2}
            transparent={true}
            opacity={isActive ? 1.0 : 0.4}
          />
        </lineSegments>
      </mesh>

      {/* Internal core light source that glows inside active cards */}
      {isActive && (
        <pointLight
          position={[0, 0, 0.2]}
          distance={2.5}
          intensity={1.2}
          color={project.color}
        />
      )}
    </group>
  );
}
