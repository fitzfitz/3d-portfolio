import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SHARDS } from "../../data/shards";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { COSMIC_BOUNDS } from "../../constants";
import { toroidalDistance3 } from "../../utils/toroidal";
import { soundManager } from "../../audio/soundManager";
import { ambientTime } from "../../utils/ambientTime";

const dummy = new THREE.Object3D();
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);
const ONE_SCALE = new THREE.Vector3(1, 1, 1);

/**
 * 10 collectible data shards scattered across the system. One InstancedMesh,
 * no React state/selectors — visibility + pickup are handled entirely via
 * getState() reads inside the frame loop, matrices carry collected/not-collected.
 */
export default function DataShards() {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => new THREE.OctahedronGeometry(0.9), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#124",
        emissive: "#9ff5ff",
        emissiveIntensity: 1.6,
        transparent: false,
      }),
    []
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = ambientTime(state.clock.getElapsedTime());
    const store = useSpaceStore.getState();
    const collected = store.shardsCollected;

    for (let i = 0; i < SHARDS.length; i++) {
      if (collected.includes(i)) {
        dummy.position.set(0, 0, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.copy(ZERO_SCALE);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const [px, py, pz] = SHARDS[i].pos;
      // Per-shard bob and spin. These were `sin(t * 1.5 + i) * 0.4` and
      // `t * 0.8 + i` — identical rate and amplitude for all ten, with only the
      // phase varying, so a cluster of shards moved as one rigid body. Deriving
      // rate and amplitude from the index as well gives each its own character
      // at no extra cost: the trig count per frame is unchanged.
      //
      // Note the pickup check below deliberately measures against the RAW `py`,
      // not the bobbed `y`, so changing the bob cannot affect collection.
      const bobRate = 1.2 + (i % 4) * 0.22;
      const bobAmp = 0.3 + (i % 3) * 0.14;
      const y = py + Math.sin(t * bobRate + i) * bobAmp;
      dummy.position.set(px, y, pz);
      // Spin on two axes, direction alternating by index, so adjacent shards
      // never turn in lockstep.
      const spin = 0.6 + (i % 5) * 0.13;
      dummy.rotation.set(Math.sin(t * 0.4 + i) * 0.3, (i % 2 ? t : -t) * spin + i, 0);
      dummy.scale.copy(ONE_SCALE);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const dist = toroidalDistance3(flight.x, flight.z, flight.y, px, pz, py, COSMIC_BOUNDS);
      if (dist < 3) {
        store.collectShard(i);
        soundManager.pickup();
        store.sendBroadcast(SHARDS[i].fact);
        if (useSpaceStore.getState().shardsCollected.length === SHARDS.length) {
          soundManager.fanfare();
          store.sendBroadcast(
            "ALL SHARDS RECOVERED // TRANSMISSION COMPLETE. THE PILOT THANKS YOU — NOW GO PRESS P AND TAKE A VICTORY PHOTO"
          );
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh name="DataShards" ref={meshRef} args={[geometry, material, SHARDS.length]} frustumCulled={false} />
  );
}
