import { Canvas, useFrame } from "@react-three/fiber";
import { Preload, Html } from "@react-three/drei";
import { Suspense, useRef, useMemo } from "react";
import * as THREE from "three";
import Spaceship from "./Spaceship";
import SpacePlanets from "./SpacePlanets";
import { PlasmaAnomalies } from "./PlasmaAnomalies";
import type { AnomaliesRef } from "./PlasmaAnomalies";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import SafeErrorBoundary from "./SafeErrorBoundary";
import Asteroids from "./Asteroids";

interface PlanetData {
  name: string;
  pos: [number, number, number];
  color: string;
  size: number;
}

interface GlobalCanvasProps {
  planets: PlanetData[];
  vehiclePos: { x: number; z: number };
  setVehiclePos: (pos: { x: number; z: number }) => void;
  onZoneOverlay: (zone: string | null) => void;
  isOrbitLocked: boolean;
  setIsOrbitLocked: (val: boolean) => void;
  isOrbitCooldown: boolean;
  onWarpStatus: (val: boolean) => void;
  isLowPerf: boolean;
  onBoundaryWrap: () => void;
}

// Glowing space starfield backdrop with multi-colored stars and twinkle effects
function GalaxyStarfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const starsCount = 2500;

  const [positions, colors] = useMemo(() => {
    const posArr = new Float32Array(starsCount * 3);
    const colArr = new Float32Array(starsCount * 3);
    for (let i = 0; i < starsCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 20 + Math.random() * 250;
      posArr[i * 3] = Math.sin(angle) * radius;
      posArr[i * 3 + 1] = (Math.random() - 0.5) * 120;
      posArr[i * 3 + 2] = Math.cos(angle) * radius;

      // Color variation (75% white, 15% blue stars, 10% red-orange stars)
      const rand = Math.random();
      if (rand < 0.75) {
        colArr[i * 3] = 1.0;
        colArr[i * 3 + 1] = 1.0;
        colArr[i * 3 + 2] = 1.0;
      } else if (rand < 0.9) {
        colArr[i * 3] = 0.72;
        colArr[i * 3 + 1] = 0.88;
        colArr[i * 3 + 2] = 1.0;
      } else {
        colArr[i * 3] = 1.0;
        colArr[i * 3 + 1] = 0.78;
        colArr[i * 3 + 2] = 0.58;
      }
    }
    return [posArr, colArr];
  }, []);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const time = state.clock.getElapsedTime();
    // Drifting rotation of stars
    pointsRef.current.rotation.y = time * 0.003;

    // Twinkling animation size modulation
    const mat = pointsRef.current.material as THREE.PointsMaterial;
    mat.size = 0.045 + Math.sin(time * 2.5) * 0.015;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={starsCount}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
          count={starsCount}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        vertexColors={true}
        size={0.05}
        transparent={true}
        opacity={0.45}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export default function GlobalCanvas({
  planets,
  vehiclePos,
  setVehiclePos,
  onZoneOverlay,
  isOrbitLocked,
  setIsOrbitLocked,
  isOrbitCooldown,
  onWarpStatus,
  isLowPerf,
  onBoundaryWrap,
}: GlobalCanvasProps) {
  const anomaliesRef = useRef<AnomaliesRef>(null);

  const handleGroundClick = (e: any) => {
    e.stopPropagation();
    if (e.point && anomaliesRef.current) {
      anomaliesRef.current.spawn(new THREE.Vector3(e.point.x, e.point.y, e.point.z));
    }
  };

  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-0 bg-[#020108]">
      <Canvas
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true,
        }}
        camera={{ position: [0, 5, 8], fov: 60 }}
        style={{ pointerEvents: "auto" }} // Listen for click spawning
        eventSource={document.getElementById("root") || undefined}
        eventPrefix="client"
      >
        <Suspense fallback={
          <Html center className="text-primary font-mono text-xs tracking-widest uppercase animate-pulse select-none pointer-events-none whitespace-nowrap">
            Initializing Star System...
          </Html>
        }>
          {/* Ambient galactic backdrop lighting */}
          <ambientLight intensity={0.35} />

          {/* Starfield particles */}
          <GalaxyStarfield />

          {/* Spaceship craft */}
          <Spaceship
            onPositionUpdate={setVehiclePos}
            onWarpStatus={onWarpStatus}
            isOrbitLocked={isOrbitLocked}
            onBoundaryWrap={onBoundaryWrap}
          />

          {/* Orbiting planets */}
          <SpacePlanets
            planets={planets}
            vehiclePos={vehiclePos}
            onZoneOverlay={onZoneOverlay}
            setIsOrbitLocked={setIsOrbitLocked}
            isOrbitCooldown={isOrbitCooldown}
          />

          {/* Scattered Deep Space Asteroids */}
          <Asteroids />

          {/* Energy Plasma particles spawner */}
          <PlasmaAnomalies
            ref={anomaliesRef}
            vehiclePos={vehiclePos}
          />

          {/* Clickable space trigger plane (follows ship and expanded to cover viewport) */}
          <mesh position={[vehiclePos.x, 0, vehiclePos.z]} rotation={[-Math.PI / 2, 0, 0]} onPointerDown={handleGroundClick}>
            <planeGeometry args={[180, 180]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        </Suspense>

        {/* Cinematic glow filters (outside Suspense so they don't unmount, protected by Error Boundary) */}
        {!isLowPerf && (
          <SafeErrorBoundary>
            <EffectComposer>
              <Bloom
                intensity={1.2}
                luminanceThreshold={0.2}
                luminanceSmoothing={0.9}
                mipmapBlur={true}
              />
            </EffectComposer>
          </SafeErrorBoundary>
        )}

        <Preload all />
      </Canvas>
    </div>
  );
}
