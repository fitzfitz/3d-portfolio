import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { flight } from "../../store/spaceStore";
import { assetUrl } from "../../utils/assetUrl";

/** Fixed pool size. Slots are preallocated at load and recycled forever. */
const ANOMALY_MAX = 40;

/** Roomy 3D box around the play space that anomalies bounce inside (spec §5). */
const ANOMALY_LIMIT = 60;

interface Anomaly {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Index into COLORS; written to the instance colour buffer on spawn. */
  colorIdx: number;
  active: boolean;
  /** Rotation phase, so a cluster of spawns does not tumble in lockstep. */
  phase: number;
}

const COLORS = ["#00f0ff", "#bd00ff", "#ec4899", "#00ff87"].map((c) => new THREE.Color(c));

/** Scratch objects, reused every frame so the loop allocates nothing. */
const shipPos = new THREE.Vector3();
const pullDir = new THREE.Vector3();
const dummy = new THREE.Object3D();
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);

/**
 * Advances every active anomaly in place. Deactivates absorbed ones.
 *
 * Returns nothing and touches no React state: absorption used to trigger a
 * setState, which meant a canvas commit mid-flight. A slot going inactive is
 * now expressed purely as a zero-scale matrix.
 */
function stepAnomalies(pool: Anomaly[], ship: THREE.Vector3): void {
  for (const m of pool) {
    if (!m.active) continue;
    const dist = m.position.distanceTo(ship);

    if (dist < 0.4) {
      m.active = false;
      continue;
    }

    // Magnetic suction toward the ship, strengthening as it closes.
    if (dist < 4.5) {
      pullDir.subVectors(ship, m.position).normalize();
      m.velocity.addScaledVector(pullDir, (1.0 - dist / 4.5) * 0.003);
    }

    m.position.add(m.velocity);
    m.velocity.multiplyScalar(0.985); // drag

    // Boundary reflection.
    if (Math.abs(m.position.x) >= ANOMALY_LIMIT) {
      m.position.x = Math.sign(m.position.x) * ANOMALY_LIMIT;
      m.velocity.x = -m.velocity.x * 0.8;
    }
    if (Math.abs(m.position.y) >= ANOMALY_LIMIT) {
      m.position.y = Math.sign(m.position.y) * ANOMALY_LIMIT;
      m.velocity.y = -m.velocity.y * 0.8;
    }
    if (Math.abs(m.position.z) >= ANOMALY_LIMIT) {
      m.position.z = Math.sign(m.position.z) * ANOMALY_LIMIT;
      m.velocity.z = -m.velocity.z * 0.8;
    }
  }
}

export interface AnomaliesRef {
  spawn: (point: THREE.Vector3) => void;
}

/**
 * Click-spawned plasma anomalies, as a preallocated InstancedMesh pool --
 * the same shape FuelCrystals and DataShards use.
 *
 * The previous version mounted a <pointLight> per anomaly. Three.js bakes the
 * light count into every shader's program cache key, so each spawn forced a
 * synchronous scene-wide shader recompile: the visible click stall. It also
 * cloned the GLTF scene and its materials per anomaly, producing 40 unique
 * materials and 40+ draw calls with no batching.
 *
 * Now: one geometry, one shared emissive material, one draw call, per-instance
 * colour, and nothing whatsoever allocated at click time. The glow comes from
 * the Bloom pass, which runs at luminanceThreshold 0.2 and blooms these at
 * emissiveIntensity 3.6 exactly as the per-anomaly lights used to.
 */
export const PlasmaAnomalies = forwardRef<AnomaliesRef>((_props, ref) => {
  const { scene } = useGLTF(assetUrl("/models/space_crystal.glb"));
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const nextSlot = useRef(0);

  // Reuse the GLB's first mesh, baked to world scale -- same approach as
  // FuelCrystals takes with the identical model.
  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((c) => { if (!src && c instanceof THREE.Mesh) src = c; });
    if (!src) throw new Error("space_crystal.glb contains no mesh");
    src.updateMatrix();
    const g = src.geometry.clone();
    g.applyMatrix4(src.matrix);
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    m.emissive = new THREE.Color("#ffffff"); // tinted per-instance below
    m.emissiveIntensity = 3.6;
    // Per-instance colour multiplies into both base and emissive only if the
    // material is told to expect an instance colour attribute.
    m.vertexColors = false;
    return { geometry: g, material: m };
  }, [scene]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  /** The pool. Allocated once, never resized. */
  const pool = useMemo<Anomaly[]>(() =>
    Array.from({ length: ANOMALY_MAX }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      colorIdx: 0,
      active: false,
      phase: 0,
    })), []);

  // Seed every instance colour once so setColorAt never runs during play.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < ANOMALY_MAX; i++) mesh.setColorAt(i, COLORS[i % COLORS.length]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useImperativeHandle(ref, () => ({
    spawn(point: THREE.Vector3) {
      // Round-robin over the fixed pool: the oldest slot is recycled once all
      // 40 are live, which is what the old `slice(-39)` cap did by rebuilding
      // the array. No allocation, no state, no render.
      const i = nextSlot.current;
      nextSlot.current = (nextSlot.current + 1) % ANOMALY_MAX;
      const m = pool[i];
      m.position.set(point.x, point.y + (Math.random() - 0.5) * 0.5, point.z);
      m.velocity.set(
        (Math.random() - 0.5) * 0.015,
        (Math.random() - 0.5) * 0.005,
        (Math.random() - 0.5) * 0.015,
      );
      m.phase = Math.random() * Math.PI * 2;
      m.active = true;
    },
  }));

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    shipPos.set(flight.x, flight.y, flight.z);
    stepAnomalies(pool, shipPos);

    // Rotation stays on the real clock rather than ambientTime: anomalies are
    // spawned by clicking, so they are user-initiated and the reduced-motion
    // spec deliberately exempts them.
    const t = state.clock.getElapsedTime();
    for (let i = 0; i < ANOMALY_MAX; i++) {
      const m = pool[i];
      if (!m.active) {
        dummy.position.set(0, 0, 0);
        dummy.scale.copy(ZERO_SCALE);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      dummy.position.copy(m.position);
      dummy.rotation.set(
        0.15 + Math.sin(t * 0.7 + m.phase) * 0.25,
        t * 1.4 + m.phase,
        Math.cos(t * 0.5 + m.phase * 1.7) * 0.2,
      );
      dummy.scale.setScalar(0.55);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh name="PlasmaAnomalies" ref={meshRef}
      args={[geometry, material, ANOMALY_MAX]} frustumCulled={false} />
  );
});

PlasmaAnomalies.displayName = "PlasmaAnomalies";
