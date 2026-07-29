import { useRef, useImperativeHandle, forwardRef, useState, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { flight } from "../../store/spaceStore";
import { assetUrl } from "../../utils/assetUrl";

interface Anomaly {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: string;
  /** Marked by the frame step; the parent prunes and re-renders once. */
  absorbed?: boolean;
}

/** Scratch vectors, reused every frame so the loop allocates nothing. */
const shipPos = new THREE.Vector3();
const pullDir = new THREE.Vector3();

/** Roomy 3D box around the play space that anomalies bounce inside (spec §5). */
const ANOMALY_LIMIT = 60;

/**
 * Advances every anomaly in place and returns true if any was absorbed.
 *
 * Deliberately mutates rather than rebuilding: the previous version cloned two
 * Vector3s and spread a fresh object per anomaly per frame, then handed the new
 * array to `setState` — up to 40 objects and 80 vectors of garbage every frame,
 * plus a React commit. Now the only allocation is at spawn.
 */
function stepAnomalies(list: Anomaly[], ship: THREE.Vector3): boolean {
  let absorbedAny = false;

  for (const m of list) {
    const dist = m.position.distanceTo(ship);

    if (dist < 0.4) {
      m.absorbed = true;
      absorbedAny = true;
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

  return absorbedAny;
}

export interface AnomaliesRef {
  spawn: (point: THREE.Vector3) => void;
}

const colors = ["#00f0ff", "#bd00ff", "#ec4899", "#00ff87"];

interface AnomalyInstanceProps {
  a: Anomaly;
  scene: THREE.Group;
}

function AnomalyInstance({ a, scene }: AnomalyInstanceProps) {
  // Clone the scene only once per component mount (prevents memory leak)
  const cloned = useMemo(() => {
    const cl = scene.clone();
    cl.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        // Ensure the mesh has a valid material clone before modifying it
        const originalMat = child.material;
        const newMat = Array.isArray(originalMat) 
          ? originalMat.map(m => m.clone()) 
          : originalMat.clone();
        
        child.material = newMat;
        const targetMat = Array.isArray(newMat) ? newMat[0] : newMat;
        
        if (targetMat.emissive) {
          // Dynamic emissive tint matching the randomized spawn colors
          targetMat.emissive = new THREE.Color(a.color);
          targetMat.emissiveIntensity = 3.6; // High intensity for bloom
        } else {
          // If no emissive properties, apply basic glowing material
          child.material = new THREE.MeshBasicMaterial({
            color: a.color,
            transparent: true,
            opacity: 0.85,
          });
        }
      }
    });
    return cl;
  }, [scene, a.color]);

  const localRef = useRef<THREE.Group>(null);

  /**
   * Position is written here, per frame, from the shared mutable `Anomaly` —
   * NOT passed down as a prop. The parent used to rebuild every anomaly object
   * each frame and re-render, which meant a React commit per frame for as long
   * as any anomaly was alive: a direct violation of this project's
   * zero-renders-during-flight guarantee. It escaped `perf.probe.mjs` because
   * that probe's steady state is empty deep space, so no anomaly ever exists
   * while it samples.
   *
   * Rotation stays on the real clock rather than `ambientTime`: anomalies are
   * spawned by clicking, so they are user-initiated and the reduced-motion spec
   * deliberately exempts them.
   */
  useFrame((state) => {
    const g = localRef.current;
    if (!g) return;
    g.position.copy(a.position);
    // Multi-axis tumble with a per-anomaly phase from `id`, so a cluster of
    // spawns does not rotate in lockstep the way a single shared axis did.
    const t = state.clock.getElapsedTime();
    g.rotation.set(0.15 + Math.sin(t * 0.7 + a.id) * 0.25, t * 1.4 + a.id, Math.cos(t * 0.5 + a.id * 1.7) * 0.2);
  });

  return (
    <group position={[a.position.x, a.position.y, a.position.z]} ref={localRef}>
      <primitive object={cloned} scale={0.55} />
      <pointLight color={a.color} intensity={0.9} distance={1.8} />
    </group>
  );
}

export const PlasmaAnomalies = forwardRef<AnomaliesRef>(
  (_props, ref) => {
    const { scene } = useGLTF(assetUrl("/models/space_crystal.glb"));
    /**
     * The live simulation, mutated in place. Deliberately a ref rather than
     * state: positions change every frame, and holding them in state meant a
     * React commit every frame while any anomaly lived. `roster` below is the
     * only thing React renders from, and it changes only on spawn or absorb.
     */
    const sim = useRef<Anomaly[]>([]);
    const [roster, setRoster] = useState<Anomaly[]>([]);
    const nextId = useRef(0);

    // Expose spawn method
    useImperativeHandle(ref, () => ({
      spawn(point: THREE.Vector3) {
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const newAnomaly: Anomaly = {
          id: nextId.current++,
          position: new THREE.Vector3(point.x, point.y + (Math.random() - 0.5) * 0.5, point.z),
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 0.015,
            (Math.random() - 0.5) * 0.005,
            (Math.random() - 0.5) * 0.015
          ),
          color: randomColor,
        };
        
        // Limit to 40 active anomalies
        sim.current = [...sim.current.slice(-39), newAnomaly];
        setRoster(sim.current);
      },
    }));

    useFrame(() => {
      const list = sim.current;
      if (list.length === 0) return;

      shipPos.set(flight.x, flight.y, flight.z);
      // Mutates each anomaly in place and returns true if any were absorbed.
      // Only an absorb changes what React renders, so that is the sole case
      // that touches state — the common case is zero commits.
      if (stepAnomalies(list, shipPos)) {
        sim.current = list.filter((m) => !m.absorbed);
        setRoster(sim.current);
      }
    });

    return (
      <group>
        {roster.map((a) => (
          <AnomalyInstance key={a.id} a={a} scene={scene} />
        ))}
      </group>
    );
  }
);

PlasmaAnomalies.displayName = "PlasmaAnomalies";
