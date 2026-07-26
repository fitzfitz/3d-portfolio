import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useSpaceStore } from "../../store/spaceStore";
import { ambientTime } from "../../utils/ambientTime";

const COUNT_FULL = 400;
const COUNT_LOW = 200;
const dummy = new THREE.Object3D();

/** Deterministic PRNG so the belt is identical every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BeltRock {
  radius: number; y: number; speed: number; phase: number;
  spinX: number; spinY: number; scale: number;
}

interface BeltRingProps {
  geometry: THREE.BufferGeometry; material: THREE.Material;
  count: number; total: number; seed: number;
  rMin: number; rMax: number; yJitter: number;
  /** plane tilt about X (rad) */
  tilt: number;
  /** scene name so e2e probes can assert instance counts */
  name: string;
}

function BeltRing({ geometry, material, count, total, seed, rMin, rMax, yJitter, tilt, name }: BeltRingProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const rocks = useMemo<BeltRock[]>(() => {
    const rand = mulberry32(seed);
    const span = rMax - rMin;
    return Array.from({ length: total }, () => {
      const radius = rMin + rand() * span;
      return {
        radius,
        y: (rand() - 0.5) * yJitter,
        // Kepler-ish: inner rocks orbit faster
        speed: 0.02 - ((radius - rMin) / span) * 0.012,
        phase: rand() * Math.PI * 2,
        spinX: 0.2 + rand() * 0.6,
        spinY: 0.2 + rand() * 0.6,
        scale: 0.05 + rand() * 0.17,
      };
    });
  }, [total, seed, rMin, rMax, yJitter]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = ambientTime(state.clock.getElapsedTime());
    for (let i = 0; i < count; i++) {
      const r = rocks[i];
      const angle = r.phase + t * r.speed;
      dummy.position.set(Math.cos(angle) * r.radius, r.y, Math.sin(angle) * r.radius);
      dummy.rotation.set(r.phase + t * r.spinX, t * r.spinY, 0);
      dummy.scale.setScalar(r.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group rotation={[tilt, 0, 0]}>
      <instancedMesh name={name} key={count} ref={meshRef} args={[geometry, material, count]}
        frustumCulled={false} dispose={null} />
    </group>
  );
}

const HALO_FULL = 160;

export default function AsteroidBelt() {
  const { scene } = useGLTF("/models/asteroids.glb");
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const count = isLowPerf ? COUNT_LOW : COUNT_FULL;

  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((c) => {
      if (!src && c instanceof THREE.Mesh && c.name.startsWith("Asteroid1")) src = c;
    });
    if (!src) throw new Error("asteroids.glb is missing mesh Asteroid1");
    src.updateMatrix();
    const g = src.geometry.clone();
    g.applyMatrix4(src.matrix);
    return { geometry: g, material: src.material as THREE.Material };
  }, [scene]);

  return (
    <>
      {/* Main belt: 25° inclined plane (spec §5) */}
      <BeltRing geometry={geometry} material={material} count={count} total={COUNT_FULL}
        seed={42} rMin={40} rMax={70} yJitter={5} tilt={0.436} name="BeltMain" />
      {/* Polar halo: sparse steep band crossing the main belt — climbing threads
          asteroid country. Skipped in low-perf mode. */}
      {!isLowPerf && (
        <BeltRing geometry={geometry} material={material} count={HALO_FULL} total={HALO_FULL}
          seed={1337} rMin={80} rMax={95} yJitter={9} tilt={1.31} name="BeltHalo" />
      )}
    </>
  );
}
