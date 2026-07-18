import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useSpaceStore } from "../../store/spaceStore";

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

export default function AsteroidBelt() {
  const { scene } = useGLTF("/models/asteroid.glb");
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const count = isLowPerf ? COUNT_LOW : COUNT_FULL;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { geometry, material } = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    let m: THREE.Material | undefined;
    scene.traverse((c) => {
      if (!g && c instanceof THREE.Mesh) { g = c.geometry; m = c.material as THREE.Material; }
    });
    if (!g || !m) throw new Error("asteroid.glb contains no mesh");
    return { geometry: g, material: m };
  }, [scene]);

  const rocks = useMemo<BeltRock[]>(() => {
    const rand = mulberry32(42);
    return Array.from({ length: COUNT_FULL }, () => {
      const radius = 40 + rand() * 30;
      return {
        radius,
        y: (rand() - 0.5) * 5,
        // Kepler-ish: inner rocks orbit faster (0.020 at r=40 down to 0.008 at r=70)
        speed: 0.02 - ((radius - 40) / 30) * 0.012,
        phase: rand() * Math.PI * 2,
        spinX: 0.2 + rand() * 0.6,
        spinY: 0.2 + rand() * 0.6,
        scale: 0.05 + rand() * 0.17,
      };
    });
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
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
    <group rotation={[0.07, 0, 0]}>
      <instancedMesh
        key={count}
        ref={meshRef}
        args={[geometry, material, count]}
        frustumCulled={false}
        dispose={null}
      />
    </group>
  );
}
