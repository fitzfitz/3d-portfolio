import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useSpaceStore, flight } from "../../store/spaceStore";
import { decay } from "../../utils/reactions";
import {
  toRingLocal, nearRing, stepRock, BELT_PUSH_HALFLIFE, BELT_RETURN_HALFLIFE,
} from "../../utils/beltPush";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { lowPolyRock } from "../../utils/lowPolyRock";

const COUNT_FULL = 400;
const COUNT_LOW = 200;
const dummy = new THREE.Object3D();
/** Scratch for the ship's ring-local position (one per frame per ring). */
const shipLocal = { x: 0, y: 0, z: 0 };

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
  spinX: number; spinY: number; spinZ: number; scale: number;
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
        // Third tumble axis. Z was hardcoded to 0 for all 560 rocks, so every
        // one of them tumbled in a constrained two-axis way that reads
        // subtly mechanical across a whole belt. This is genuinely free:
        // Euler->matrix composition below computes sin/cos of all three angles
        // regardless of whether Z is zero, so a real value costs nothing.
        // Signed, so rocks tumble both directions rather than all one way.
        spinZ: (rand() - 0.5) * 0.9,
        scale: 0.05 + rand() * 0.17,
      };
    });
  }, [total, seed, rMin, rMax, yJitter]);

  // Per-rock push displacement (spec: belt parts around the ship). Sized to
  // `total` so a low-perf count change never reallocates.
  const disp = useMemo(() => new Float32Array(total * 3), [total]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const t = ambientTime(state.clock.getElapsedTime());
    const dt = Math.min(delta, 0.05);
    const react = !useSpaceStore.getState().reducedMotion;
    const ship = react && nearRing(flight, rMin, rMax) ? toRingLocal(shipLocal, flight, tilt) : null;
    const kPush = decay(BELT_PUSH_HALFLIFE, dt);
    const kReturn = decay(BELT_RETURN_HALFLIFE, dt);
    for (let i = 0; i < count; i++) {
      const r = rocks[i];
      const angle = r.phase + t * r.speed;
      const x = Math.cos(angle) * r.radius, y = r.y, z = Math.sin(angle) * r.radius;
      if (react) stepRock(disp, i, x, y, z, ship, kPush, kReturn);
      const j = i * 3;
      dummy.position.set(x + disp[j], y + disp[j + 1], z + disp[j + 2]);
      dummy.rotation.set(r.phase + t * r.spinX, t * r.spinY, t * r.spinZ);
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
const BELT_ROCK_RADIUS = 1.1;

export default function AsteroidBelt() {
  const { scene } = useGLTF(assetUrl("/models/asteroids.glb"));
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const count = isLowPerf ? COUNT_LOW : COUNT_FULL;

  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((c) => {
      if (!src && c instanceof THREE.Mesh && c.name.startsWith("Asteroid1")) src = c;
    });
    if (!src) throw new Error("asteroids.glb is missing mesh Asteroid1");
    // Size-matched stand-in, not the hero mesh: Asteroid1 is 1,244 triangles,
    // and drawing it 560 times at scale 0.05-0.22 was ~85% of the whole
    // scene's triangles for detail nobody can see. The hero asteroids
    // (Asteroids.tsx) keep the real mesh; the belt keeps its material.
    // Fixed radius rather than measured from the hero mesh: the hero rocks
    // are authored at radius ~2 to match their colliders, and the belt's
    // per-instance scales (0.05-0.22) were tuned against a ~1.1u rock.
    return { geometry: lowPolyRock(BELT_ROCK_RADIUS, 42), material: src.material as THREE.Material };
  }, [scene]);
  useEffect(() => () => geometry.dispose(), [geometry]);

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
