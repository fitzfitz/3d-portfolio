import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useModel } from "../../utils/sceneAssets";
import * as THREE from "three";
import { GATE_POS, GATE_RADIUS, GATE_SCAN_ID, GATE_SCAN_LABEL } from "../../data/dormantGate";
import { gateDistance, gateLine, gateRadio, seamIntensity } from "../../utils/gatePass";
import { setScannable, removeScannable } from "../../utils/scannables";
import { ambientTime } from "../../utils/ambientTime";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { assetUrl } from "../../utils/assetUrl";

const POSITION: [number, number, number] = [GATE_POS[0], GATE_POS[1], GATE_POS[2]];

/**
 * The dormant gate (docs/archive/specs/2026-10-16-shipyard-gate-design.md),
 * built by scripts/blender/gen_dormant_gate.py. Its opening (+Z) is turned to
 * face the sun. The glyph seams pulse faintly and flicker as a ship closes
 * in (gatePass.seamIntensity: a uniform change, no new shader program).
 * Two one-time radio lines (gatePass.gateLine) go out as content broadcasts,
 * so the radio hold protects them from chatter. No collider: flying through
 * the frame is allowed, as at the station and the portal.
 */
export default function DormantGate() {
  const { scene } = useModel(assetUrl("/models/dormant_gate.glb"));
  const group = useRef<THREE.Group>(null);
  const seam = useMemo(() => {
    let found: THREE.MeshStandardMaterial | null = null;
    scene.traverse((o) => {
      if (!found && o instanceof THREE.Mesh && (o.material as THREE.Material).name === "GlyphSeam") {
        found = o.material as THREE.MeshStandardMaterial;
      }
    });
    return found as THREE.MeshStandardMaterial | null;
  }, [scene]);
  const prev = useRef({ x: flight.x, y: flight.y, z: flight.z });

  // Object3D.lookAt points +Z at the target for non-cameras: the opening faces the sun.
  useLayoutEffect(() => { group.current?.lookAt(0, 0, 0); }, []);

  useEffect(() => {
    setScannable(GATE_SCAN_ID, GATE_POS[0], GATE_POS[1], GATE_POS[2], GATE_SCAN_LABEL, GATE_RADIUS);
    return () => removeScannable(GATE_SCAN_ID);
  }, []);

  useFrame((state) => {
    const { reducedMotion } = useSpaceStore.getState();
    if (seam) seam.emissiveIntensity = seamIntensity(ambientTime(state.clock.getElapsedTime()), gateDistance(flight), reducedMotion);
    const line = gateLine(gateRadio, prev.current, flight);
    if (line) useSpaceStore.getState().sendBroadcast(line);
    prev.current.x = flight.x; prev.current.y = flight.y; prev.current.z = flight.z;
  });

  return (
    <group ref={group} position={POSITION}>
      <primitive object={scene} />
    </group>
  );
}
