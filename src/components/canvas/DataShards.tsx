import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SHARDS, SHARDS_COMPLETE_MESSAGE, shardBroadcast } from "../../data/shards";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { COSMIC_BOUNDS } from "../../constants";
import { toroidalDistance3 } from "../../utils/toroidal";
import { soundManager } from "../../audio/soundManager";
import { ambientTime } from "../../utils/ambientTime";

const dummy = new THREE.Object3D();
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);
const ONE_SCALE = new THREE.Vector3(1, 1, 1);

/**
 * Gap between the last shard's fact and the completion fanfare. Both go
 * through RadioChatter's single typewriter line, which cancels whatever it is
 * typing, so sending them in the same frame meant the tenth fact never showed.
 */
const COMPLETE_DELAY_MS = 4500;

/**
 * 10 collectible data shards scattered across the system. One InstancedMesh,
 * no React state/selectors — visibility + pickup are handled entirely via
 * getState() reads inside the frame loop, matrices carry collected/not-collected.
 */
export default function DataShards() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const geometry = useMemo(() => new THREE.OctahedronGeometry(0.9), []);
  const material = useMemo(
    () =>
      // Faceted and lit, with a moderate glow. At emissive 1.6 every face
      // was the same saturated cyan, so the octahedron read as a flat
      // diamond — two of them flank the spawn point and looked like
      // untextured placeholder quads.
      new THREE.MeshStandardMaterial({
        color: "#3fb6d4",
        metalness: 0.55,
        roughness: 0.2,
        flatShading: true,
        emissive: "#4fe3ff",
        emissiveIntensity: 0.45,
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

  // Leaving for the classic résumé inside the delay unmounts this; the
  // fanfare would otherwise play over the résumé.
  useEffect(() => () => { if (completeTimer.current) clearTimeout(completeTimer.current); }, []);

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
      const bobAmp = 1.2 + (i % 3) * 0.56;
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
        const count = useSpaceStore.getState().shardsCollected.length;
        store.sendBroadcast(shardBroadcast(SHARDS[i].fact, count));
        if (count === SHARDS.length) {
          completeTimer.current = setTimeout(() => {
            soundManager.fanfare();
            useSpaceStore.getState().sendBroadcast(SHARDS_COMPLETE_MESSAGE);
          }, COMPLETE_DELAY_MS);
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh name="DataShards" ref={meshRef} args={[geometry, material, SHARDS.length]} frustumCulled={false} />
  );
}
