import { Canvas, useFrame } from "@react-three/fiber";
import { Preload, Html, AdaptiveDpr, PerformanceMonitor, Environment, Lightformer } from "@react-three/drei";
import { Suspense, useRef, useMemo, useState } from "react";
import * as THREE from "three";
import Spaceship from "./Spaceship";
import SpacePlanets from "./SpacePlanets";
import Sun from "./Sun";
import { PlasmaAnomalies } from "./PlasmaAnomalies";
import type { AnomaliesRef } from "./PlasmaAnomalies";
import { EffectComposer, Bloom, Vignette, ChromaticAberration, GodRays } from "@react-three/postprocessing";
import SafeErrorBoundary from "./SafeErrorBoundary";
import Asteroids from "./Asteroids";
import AsteroidBelt from "./AsteroidBelt";
import ShootingStars from "./ShootingStars";
import DistantGalaxies from "./DistantGalaxies";
import { flight, useSpaceStore } from "../../store/spaceStore";

interface StarLayerProps {
  count: number;
  radiusMin: number;
  radiusMax: number;
  size: number;
  opacity: number;
  /** rad/s around Y; sign controls direction */
  speed: number;
  twinkle?: boolean;
}

function StarLayer({ count, radiusMin, radiusMax, size, opacity, speed, twinkle = false }: StarLayerProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const [positions, colors] = useMemo(() => {
    const posArr = new Float32Array(count * 3);
    const colArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = radiusMin + Math.random() * (radiusMax - radiusMin);
      posArr[i * 3] = Math.sin(angle) * radius;
      posArr[i * 3 + 1] = (Math.random() - 0.5) * 120;
      posArr[i * 3 + 2] = Math.cos(angle) * radius;
      const rand = Math.random();
      if (rand < 0.75) colArr.set([1, 1, 1], i * 3);
      else if (rand < 0.9) colArr.set([0.72, 0.88, 1.0], i * 3);
      else colArr.set([1.0, 0.78, 0.58], i * 3);
    }
    return [posArr, colArr];
  }, [count, radiusMin, radiusMax]);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const time = state.clock.getElapsedTime();
    pointsRef.current.rotation.y = time * speed;
    if (twinkle) {
      const mat = pointsRef.current.material as THREE.PointsMaterial;
      mat.size = size + Math.sin(time * 2.5) * size * 0.3;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial vertexColors={true} size={size} transparent={true} opacity={opacity}
        blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

// Three-depth parallax sky: far slow, mid counter-rotating, near faster + twinkling.
function GalaxyStarfield() {
  return (
    <>
      <StarLayer count={1300} radiusMin={140} radiusMax={260} size={0.04} opacity={0.35} speed={0.0015} />
      <StarLayer count={800} radiusMin={80} radiusMax={180} size={0.05} opacity={0.45} speed={-0.003} />
      <StarLayer count={400} radiusMin={40} radiusMax={120} size={0.07} opacity={0.6} speed={0.006} twinkle={true} />
    </>
  );
}

function FollowingClickPlane({ onSpawn }: { onSpawn: (p: THREE.Vector3) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (ref.current) ref.current.position.set(flight.x, 0, flight.z);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(e) => { e.stopPropagation(); if (e.point) onSpawn(e.point.clone()); }}>
      <planeGeometry args={[180, 180]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

export default function GlobalCanvas() {
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const isWarping = useSpaceStore((s) => s.isWarping);
  const anomaliesRef = useRef<AnomaliesRef>(null);
  const [sunMesh, setSunMesh] = useState<THREE.Mesh | null>(null);

  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-0 bg-[#020108]">
      <Canvas
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        camera={{ position: [0, 5, 8], fov: 60 }}
        style={{ pointerEvents: "auto" }} // Listen for click spawning
        eventSource={document.getElementById("root") || undefined}
        eventPrefix="client"
      >
        <AdaptiveDpr pixelated />
        <PerformanceMonitor
          onDecline={() => {
            const s = useSpaceStore.getState();
            if (!s.lowPerfManual && !s.isLowPerf) s.setLowPerf(true);
          }}
        />
        <Suspense fallback={
          <Html center className="text-primary font-mono text-xs tracking-widest uppercase animate-pulse select-none pointer-events-none whitespace-nowrap">
            Initializing Star System...
          </Html>
        }>
          {/* Static generated IBL: cool spacelight + warm sun echo. frames={1} renders it once. */}
          <Environment resolution={64} frames={1}>
            <color attach="background" args={["#050310"]} />
            <Lightformer form="rect" intensity={1.1} color="#3a4a8f" position={[0, 8, -10]} scale={[14, 7, 1]} />
            <Lightformer form="rect" intensity={0.7} color="#ff5500" position={[9, -3, 4]} scale={[8, 4, 1]} />
            <Lightformer form="rect" intensity={0.6} color="#00f0ff" position={[-9, 2, 5]} scale={[6, 6, 1]} />
          </Environment>

          {/* Ambient galactic backdrop lighting */}
          <ambientLight intensity={0.15} />

          {/* Starfield particles */}
          <GalaxyStarfield />

          {/* Distant procedural spiral galaxies */}
          <DistantGalaxies />

          {/* Spaceship craft */}
          <Spaceship />

          {/* Orbiting planets */}
          <SpacePlanets />

          {/* Central sun core + corona/flare shell */}
          <Sun onSunReady={setSunMesh} />

          {/* Scattered Deep Space Asteroids */}
          <Asteroids />

          {/* Asteroid Belt */}
          <AsteroidBelt />

          {/* Energy Plasma particles spawner */}
          <PlasmaAnomalies ref={anomaliesRef} />

          {/* Pooled shooting star streaks */}
          {!isLowPerf && <ShootingStars />}

          {/* Clickable space trigger plane (follows ship and expanded to cover viewport) */}
          <FollowingClickPlane onSpawn={(p) => anomaliesRef.current?.spawn(p)} />
        </Suspense>

        {/* Cinematic glow filters (outside Suspense so they don't unmount, protected by Error Boundary) */}
        {!isLowPerf && (
          <SafeErrorBoundary>
            <EffectComposer>
              {(() => {
                const effects = [
                  <Bloom key="bloom" intensity={1.2} luminanceThreshold={0.2} luminanceSmoothing={0.9} mipmapBlur={true} />,
                  <Vignette key="vignette" eskil={false} offset={0.28} darkness={0.72} />,
                  <ChromaticAberration key="ca" offset={isWarping ? [0.0022, 0.0014] : [0, 0]} />,
                ];
                if (sunMesh) {
                  effects.push(
                    <GodRays key="rays" sun={sunMesh} samples={60} density={0.9} decay={0.94}
                      weight={0.25} exposure={0.28} clampMax={1} blur={true} />
                  );
                }
                return effects;
              })()}
            </EffectComposer>
          </SafeErrorBoundary>
        )}

        <Preload all />
      </Canvas>
    </div>
  );
}
