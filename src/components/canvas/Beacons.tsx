import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSpaceStore } from "../../store/spaceStore";
import { BEACON_LIMIT, beaconRegistry, type Beacon } from "../../utils/beacons";
import { setScannable, removeScannable } from "../../utils/scannables";
import { ambientTime } from "../../utils/ambientTime";

const OTHERS = new THREE.Color("#00ff87").multiplyScalar(1.6);
const MINE = new THREE.Color("#ec4899").multiplyScalar(1.8);
const dummy = new THREE.Object3D();

/**
 * Beacons left by earlier visitors: small bobbing buoys, scannable for their
 * message. One instanced draw. Mounted only when the beacon API is configured.
 *
 * The material deliberately matches RingCourse's rings (basic, additive,
 * instance-coloured, untone-mapped) so the two share one shader program.
 */
export default function Beacons() {
  const beacons = useSpaceStore((s) => s.beacons);
  const own = useSpaceStore((s) => s.ownBeacons);
  const listRef = useRef<Beacon[]>([]);

  const mesh = useMemo(() => {
    const geometry = new THREE.OctahedronGeometry(0.55, 0);
    const material = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false,
    });
    const m = new THREE.InstancedMesh(geometry, material, BEACON_LIMIT);
    // Colour buffer up front so warm-up compiles the instance-colour variant.
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BEACON_LIMIT * 3), 3);
    m.count = 0;
    m.name = "Beacons";
    m.frustumCulled = false;
    return m;
  }, []);
  useEffect(() => () => {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh.dispose();
  }, [mesh]);

  useEffect(() => {
    listRef.current = beacons;
    beacons.forEach((b, i) => {
      const id = `beacon_${b.id}`;
      beaconRegistry.set(id, b);
      setScannable(id, b.x, b.y, b.z, own.includes(b.id) ? "YOUR BEACON" : "PILOT BEACON");
      mesh.setColorAt(i, own.includes(b.id) ? MINE : OTHERS);
    });
    mesh.count = beacons.length;
    mesh.instanceColor!.needsUpdate = true;
    return () => {
      for (const b of beacons) {
        beaconRegistry.delete(`beacon_${b.id}`);
        removeScannable(`beacon_${b.id}`);
      }
    };
  }, [beacons, own, mesh]);

  useFrame((state) => {
    const list = listRef.current;
    if (!list.length) return;
    const t = ambientTime(state.clock.getElapsedTime());
    list.forEach((b, i) => {
      dummy.position.set(b.x, b.y + Math.sin(t * 1.3 + i) * 0.25, b.z);
      dummy.rotation.set(0, t * 0.8 + i, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}
