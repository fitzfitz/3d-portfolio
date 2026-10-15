import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { STATION_POS } from "../../data/careerTrail";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";

/** rad/s: one turn in about 50 s, slow enough to read as mass. */
const RING_SPIN = 0.12;
const POSITION: [number, number, number] = [STATION_POS[0], STATION_POS[1], STATION_POS[2]];

/**
 * The career station (docs/superpowers/specs/2026-10-15-career-landmarks-design.md §1),
 * built by scripts/blender/gen_career_station.py. Docking is SpacePlanets'
 * zone check on the destination table and opens the Career dossier. There is
 * no collider, as with the portal: the lock radius (5.8) lies outside the
 * model (≤ 5.3), so an approaching ship docks before it reaches the hull. The
 * habitat ring stops turning under reduced motion (ambientTime freezes).
 */
export default function CareerStation() {
  const { scene } = useGLTF(assetUrl("/models/career_station.glb"));
  const ring = useMemo(() => scene.getObjectByName("HabitatRing") ?? null, [scene]);
  useFrame((state) => {
    if (ring) ring.rotation.y = ambientTime(state.clock.getElapsedTime()) * RING_SPIN;
  });
  return <primitive object={scene} position={POSITION} />;
}
