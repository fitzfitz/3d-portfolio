import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { BUOYS, BUOY_POSITIONS, CAREER_AMBER, TRAIL_ARC } from "../../data/careerTrail";
import { setScannable, removeScannable } from "../../utils/scannables";
import { ambientTime, gameTime } from "../../utils/ambientTime";
import { activeBuoy, buoyCardState } from "../../utils/buoyCard";
import { flight } from "../../store/spaceStore";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { assetUrl } from "../../utils/assetUrl";
import { arcPlacement } from "../../utils/trailGuide";
import { makeGuideLineMaterial } from "./guideLine";

/** The model is ~3.3 tall; at 1.8x a buoy reads from the next one, 42 units away. */
const BUOY_SCALE = 1.8;
const BUOY_GLOW = 2.2;
/** Dash period along the trail, in world units. */
const DASH_LENGTH = 2.5;
const GUIDE_HALF_WIDTH = 0.08;
const dummy = new THREE.Object3D();

/**
 * The career trail (spec §1): five buoys, oldest job first, as ONE
 * InstancedMesh with Data_Shard's material configuration (no new shader
 * program), joined by one dashed guide arc drawn with the orbit rings' guide
 * material. Each buoy is a scannable (career_<n>, CAREER_<year>).
 */
export default function CareerTrail() {
  const { scene } = useGLTF(assetUrl("/models/buoy.glb"));
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((o) => { if (!src && o instanceof THREE.Mesh) src = o; });
    if (!src) throw new Error("buoy.glb contains no mesh");
    // Float-safe: the quantized GLB stores positions in [-1, 1] (see util).
    const g = bakeNodeTransform(src);
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    m.emissiveIntensity = BUOY_GLOW;
    return { geometry: g, material: m };
  }, [scene]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  const guide = useMemo(() => {
    const g = new THREE.RingGeometry(
      TRAIL_ARC.radius - GUIDE_HALF_WIDTH, TRAIL_ARC.radius + GUIDE_HALF_WIDTH, 160, 1, 0, TRAIL_ARC.span,
    );
    const m = makeGuideLineMaterial({
      color: CAREER_AMBER, opacity: 0.5,
      dashes: Math.round((2 * Math.PI * TRAIL_ARC.radius) / DASH_LENGTH),
      fadeIn: [4, 14], fadeOut: [180, 280],
    });
    return { geometry: g, material: m, ...arcPlacement(TRAIL_ARC) };
  }, []);
  useEffect(() => () => { guide.geometry.dispose(); guide.material.dispose(); }, [guide]);

  // Buoys never move: their matrices are written once.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    BUOY_POSITIONS.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(0, i * 1.3, 0);
      dummy.scale.setScalar(BUOY_SCALE);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [geometry]);

  useEffect(() => {
    for (const b of BUOYS) setScannable(b.id, b.pos[0], b.pos[1], b.pos[2], b.label);
    return () => { for (const b of BUOYS) removeScannable(b.id); };
  }, []);

  useFrame((state) => {
    // Nav-light blink: a short full-strength flash about every 2.5 s. ambientTime
    // freezes under reduced motion, which leaves the glow steady.
    const phase = (ambientTime(state.clock.getElapsedTime()) * 0.4) % 1;
    material.emissiveIntensity = BUOY_GLOW * (phase < 0.12 ? 1 : 0.55);
    // Fly-by card (BuoyCard reads this). gameTime survives the clock reset an
    // orbit lock causes, and keeps running under reduced motion.
    const prev = buoyCardState.index >= 0 ? buoyCardState.index : null;
    const next = activeBuoy(flight, BUOY_POSITIONS, prev, buoyCardState.scan, gameTime(state.clock.getElapsedTime()));
    buoyCardState.index = next ?? -1;
  });

  return (
    <group>
      <instancedMesh name="CareerBuoys" ref={meshRef} args={[geometry, material, BUOYS.length]} frustumCulled={false} />
      <mesh name="CareerTrailGuide" geometry={guide.geometry} material={guide.material}
        position={guide.position} quaternion={guide.quaternion} />
    </group>
  );
}
