import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { SHIPYARD_POS } from "../../data/shipyard";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";

/** The trolley slides ±TROLLEY_RUN along the gantry, one round trip every TROLLEY_PERIOD_S. */
const TROLLEY_RUN = 2.8;
const TROLLEY_PERIOD_S = 20;
const POSITION: [number, number, number] = [SHIPYARD_POS[0], SHIPYARD_POS[1], SHIPYARD_POS[2]];

/**
 * The shipyard (docs/superpowers/specs/2026-10-16-shipyard-gate-design.md §1),
 * built by scripts/blender/gen_shipyard.py. Docking is SpacePlanets' zone
 * check on the destination table and opens the Hangar. No collider, as with
 * the station: the lock radius (7.2) lies outside the model (≤ 5.0) by more
 * than the ship's half length. The crane stops under reduced motion
 * (ambientTime freezes).
 */
export default function Shipyard() {
  const { scene } = useGLTF(assetUrl("/models/shipyard.glb"));
  const trolley = useMemo(() => scene.getObjectByName("CraneTrolley") ?? null, [scene]);
  useFrame((state) => {
    if (!trolley) return;
    const t = ambientTime(state.clock.getElapsedTime());
    trolley.position.x = Math.sin((2 * Math.PI * t) / TROLLEY_PERIOD_S) * TROLLEY_RUN;
  });
  return <primitive object={scene} position={POSITION} />;
}
