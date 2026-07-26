import { Canvas, useFrame } from "@react-three/fiber";
import { Preload, Html, AdaptiveDpr, PerformanceMonitor, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Suspense, useRef, useMemo, useState } from "react";
import * as THREE from "three";
import { ambientTime } from "../../utils/ambientTime";
import Spaceship from "./Spaceship";
import SpacePlanets from "./SpacePlanets";
import Sun from "./Sun";
import { PlasmaAnomalies } from "./PlasmaAnomalies";
import type { AnomaliesRef } from "./PlasmaAnomalies";
import { EffectComposer, Bloom, Vignette, ChromaticAberration, GodRays } from "@react-three/postprocessing";
import SafeErrorBoundary from "./SafeErrorBoundary";
import Asteroids from "./Asteroids";
import AsteroidBelt from "./AsteroidBelt";
import CargoTraffic from "./CargoTraffic";
import ShootingStars from "./ShootingStars";
import DistantGalaxies from "./DistantGalaxies";
import WarpTunnel from "./WarpTunnel";
import SpaceJellyfish from "./SpaceJellyfish";
import Comets from "./Comets";
import DataShards from "./DataShards";
import FuelCrystals from "./FuelCrystals";
import Scanner from "./Scanner";
import { flight, useSpaceStore } from "../../store/spaceStore";
import DebugBridge from "../../debug/DebugBridge";

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
      // Uniform on the sphere: y = cos(polar) uniform in [-1, 1)
      const u = Math.random() * 2 - 1;
      const az = Math.random() * Math.PI * 2;
      const sr = Math.sqrt(1 - u * u);
      const radius = radiusMin + Math.random() * (radiusMax - radiusMin);
      posArr[i * 3] = sr * Math.cos(az) * radius;
      posArr[i * 3 + 1] = u * radius;
      posArr[i * 3 + 2] = sr * Math.sin(az) * radius;
      const rand = Math.random();
      if (rand < 0.75) colArr.set([1, 1, 1], i * 3);
      else if (rand < 0.9) colArr.set([0.72, 0.88, 1.0], i * 3);
      else colArr.set([1.0, 0.78, 0.58], i * 3);
    }
    return [posArr, colArr];
  }, [count, radiusMin, radiusMax]);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const time = ambientTime(state.clock.getElapsedTime());
    // The shells are the infinite sky: they translate with the ship (no positional
    // parallax — the DustField supplies that) and keep their slow rotation drift.
    pointsRef.current.position.set(flight.x, flight.y, flight.z);
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

const DUST_COUNT = 350;
const DUST_CUBE = 120;
const DUST_HALF = DUST_CUBE / 2;

/**
 * Near-field "dust" stars: world-anchored points wrapped modulo a cube that
 * rides with the ship — free parallax speed cues on every axis (spec §4).
 */
function DustField() {
  const pointsRef = useRef<THREE.Points>(null);
  const seeds = useMemo(() => {
    const a = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < a.length; i++) a[i] = Math.random() * DUST_CUBE;
    return a;
  }, []);
  const positions = useMemo(() => new Float32Array(DUST_COUNT * 3), []);

  useFrame(() => {
    if (!pointsRef.current) return;
    pointsRef.current.position.set(flight.x, flight.y, flight.z);
    const ship = [flight.x, flight.y, flight.z];
    const attr = pointsRef.current.geometry.attributes.position;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      let d = (seeds[i] - ship[i % 3]) % DUST_CUBE;
      if (d < -DUST_HALF) d += DUST_CUBE;
      else if (d >= DUST_HALF) d -= DUST_CUBE;
      arr[i] = d;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]}
          count={DUST_COUNT} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color="#9fb4d8" size={0.05} transparent={true} opacity={0.5}
        blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

// Three-depth parallax sky: far slow, mid counter-rotating, near faster + twinkling.
function GalaxyStarfield({ isLowPerf }: { isLowPerf: boolean }) {
  return (
    <>
      {/* Rates were 0.0015 / -0.003 / 0.006 rad/s — periods of 70, 35 and 17
          MINUTES, indistinguishable from static over any real visit. Calibrated
          by eye and baked at 12x those originals, giving ~5.2 / 2.6 / 1.3 minute
          periods, so the parallax between the three counter-rotating depths
          actually reads. Free — one rotation write per layer per frame. */}
      <StarLayer count={1300} radiusMin={140} radiusMax={260} size={0.04} opacity={0.35} speed={0.02} />
      <StarLayer count={800} radiusMin={80} radiusMax={180} size={0.05} opacity={0.45} speed={-0.04} />
      <StarLayer count={400} radiusMin={40} radiusMax={120} size={0.07} opacity={0.6} speed={0.08} twinkle={true} />
      {!isLowPerf && <DustField />}
    </>
  );
}

function FollowingClickPlane({ onSpawn }: { onSpawn: (p: THREE.Vector3) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    ref.current.position.set(flight.x, flight.y, flight.z);
    ref.current.quaternion.copy(camera.quaternion); // face the camera at any pitch
  });
  return (
    <mesh ref={ref}
      onPointerDown={(e) => { e.stopPropagation(); if (e.point) onSpawn(e.point.clone()); }}>
      <planeGeometry args={[180, 180]} />
      <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function GlobalCanvas() {
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const isWarping = useSpaceStore((s) => s.isWarping);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const photoMode = useSpaceStore((s) => s.photoMode);
  const anomaliesRef = useRef<AnomaliesRef>(null);
  const [sunMesh, setSunMesh] = useState<THREE.Mesh | null>(null);
  // Snapshot the ship's position the instant photo mode flips true so the orbit
  // target stays fixed for the session — deliberately NOT re-snapshotting every
  // frame (that would fight the user's orbit drag). Re-runs only when photoMode
  // itself toggles, not when flight.x/y/z change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const photoTarget = useMemo(() => new THREE.Vector3(flight.x, flight.y, flight.z), [photoMode]);

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
          {import.meta.env.DEV && <DebugBridge />}

          {/* Static generated IBL: cool spacelight + warm sun echo. frames={1} renders it once. */}
          <Environment resolution={64} frames={1}>
            <color attach="background" args={["#050310"]} />
            <Lightformer form="rect" intensity={1.1} color="#3a4a8f" position={[0, 8, -10]} scale={[14, 7, 1]} />
            <Lightformer form="rect" intensity={0.7} color="#ff5500" position={[9, -3, 4]} scale={[8, 4, 1]} />
            <Lightformer form="rect" intensity={0.6} color="#00f0ff" position={[-9, 2, 5]} scale={[6, 6, 1]} />
          </Environment>

          {/* Ambient galactic backdrop lighting */}
          <ambientLight intensity={0.15} />
          {/* The sun: single dominant light at the origin — gives every body a
              real day side and terminator (realistic-planets spec G2) */}
          <pointLight position={[0, 0, 0]} intensity={2.0} decay={0} color="#fff4e0" />

          {/* Starfield particles */}
          <GalaxyStarfield isLowPerf={isLowPerf} />

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

          {/* NPC Cargo Traffic */}
          <CargoTraffic />

          {/* Energy Plasma particles spawner */}
          <PlasmaAnomalies ref={anomaliesRef} />

          {/* Pooled shooting star streaks */}
          {!isLowPerf && !reducedMotion && <ShootingStars />}

          {/* Warp tunnel around the ship during boost */}
          {!isLowPerf && !reducedMotion && <WarpTunnel />}

          {/* Rare drifting space jellyfish with undulation shader (J to summon) */}
          <SpaceJellyfish />

          {/* Comets with anti-sunward tails */}
          <Comets />

          {/* Collectible data shards scattered across the system */}
          <DataShards />

          {/* Floating warp-fuel crystals */}
          <FuelCrystals />

          {/* Headless: drives proximity scan targeting/progress/report dispatch */}
          <Scanner />

          {/* Clickable space trigger plane (follows ship and expanded to cover viewport).
              Unmounted in photo mode: R3F synthetic pointer events and OrbitControls
              share the same eventSource, so a drag-to-orbit pointerdown would also
              spawn a plasma anomaly into the clean frame — stopPropagation doesn't
              help across sibling listeners. */}
          {!photoMode && <FollowingClickPlane onSpawn={(p) => anomaliesRef.current?.spawn(p)} />}
        </Suspense>

        {/* Photo mode: free orbit around the ship's position at the moment of toggle */}
        {photoMode && <OrbitControls makeDefault enableDamping target={photoTarget} />}

        {/* Cinematic glow filters (outside Suspense so they don't unmount, protected by Error Boundary) */}
        {!isLowPerf && (
          <SafeErrorBoundary>
            {/* multisampling=0: the GodRays depth passes' buffer formats are incompatible
                with the MSAA resolve blit (GL_INVALID_OPERATION every frame -> white canvas).
                Bloom smooths edges anyway, so MSAA here bought nothing. */}
            <EffectComposer multisampling={0}>
              {(() => {
                const effects = [
                  <Bloom key="bloom" intensity={1.2} luminanceThreshold={0.2} luminanceSmoothing={0.9} mipmapBlur={true} />,
                  <Vignette key="vignette" eskil={false} offset={0.28} darkness={0.72} />,
                  <ChromaticAberration key="ca" offset={isWarping && !reducedMotion ? [0.0022, 0.0014] : [0, 0]} />,
                ];
                if (sunMesh) {
                  effects.push(
                    // Accumulator budget: HDR sun (emissive 3.2) x weight x decay-series(~10) x exposure
                    // must stay well under 1.0 or the clamp saturates to a white wash (seen at spawn
                    // where the sun is dead-center). 3.2 x 0.08 x 10 x 0.18 = 0.46 peak.
                    <GodRays key="rays" sun={sunMesh} samples={60} density={0.8} decay={0.9}
                      weight={0.08} exposure={0.18} clampMax={0.8} blur={true} />
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
