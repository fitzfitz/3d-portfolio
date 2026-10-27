import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useModel } from "../../../utils/sceneAssets";
import { assetUrl } from "../../../utils/assetUrl";
import { bakeNodeTransform } from "../../../utils/bakeNodeTransform";
import { setScannable, removeScannable } from "../../../utils/scannables";
import { useSpaceStore } from "../../../store/spaceStore";
import { NEST_BUOY_POS, NEST_LABEL, NEST_RED, NEST_SCAN_ID } from "../../../data/nest";
import { glowScale } from "../../../utils/sunLight";

/** As the career buoys (CareerTrail BUOY_SCALE): the model is ~3.3 tall. */
const NEST_BUOY_SCALE = 1.8;
/** The red tint on the buoy's albedo. */
const NEST_BUOY_TINT = "#ff8a8a";
/** The warning light: 0.4 ↔ 2.2 at 1 Hz, on for this share of each second; steady under reduced motion. */
const BLINK_LOW = 0.4;
const BLINK_HIGH = 2.2;
const BLINK_ON = 0.35;
const BLINK_STEADY = 1.6;

/**
 * The Nest's warning buoy (spec 2026-10-27-combat), always mounted: the
 * career buoy's model 120 u from the centre on the side facing the inner
 * system (data/nest.ts NEST_BUOY_POS), red with a blinking red light. One
 * InstancedMesh of 1 with CareerTrail's material configuration (a clone of
 * the model's material, instanced, no instance colour), so it shares the
 * career buoys' program and adds none; the red is the material's colour and
 * emissive, uniforms only. A scannable (the_nest, THE_NEST).
 */
export default function NestBuoy() {
  const { scene } = useModel(assetUrl("/models/buoy.glb"));
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((o) => { if (!src && o instanceof THREE.Mesh) src = o; });
    if (!src) throw new Error("buoy.glb contains no mesh");
    const g = bakeNodeTransform(src);
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    m.color.multiply(new THREE.Color(NEST_BUOY_TINT));
    m.emissive.set(NEST_RED);
    m.emissiveIntensity = BLINK_STEADY;
    return { geometry: g, material: m };
  }, [scene]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  // The buoy never moves: its matrix is written once, and its bounds fitted
  // to it so it is culled (no draw call) when out of view.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const d = new THREE.Object3D();
    d.position.set(NEST_BUOY_POS[0], NEST_BUOY_POS[1], NEST_BUOY_POS[2]);
    d.scale.setScalar(NEST_BUOY_SCALE);
    d.updateMatrix();
    mesh.setMatrixAt(0, d.matrix);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [geometry]);

  useEffect(() => {
    setScannable(NEST_SCAN_ID, NEST_BUOY_POS[0], NEST_BUOY_POS[1], NEST_BUOY_POS[2], NEST_LABEL);
    return () => removeScannable(NEST_SCAN_ID);
  }, []);

  useFrame((state) => {
    // × glowScale: the warning light is self-lit, so it holds its 1 AU glow far out.
    const g = glowScale.value;
    if (useSpaceStore.getState().reducedMotion) {
      material.emissiveIntensity = BLINK_STEADY * g;
      return;
    }
    const phase = state.clock.getElapsedTime() % 1;
    material.emissiveIntensity = (phase < BLINK_ON ? BLINK_HIGH : BLINK_LOW) * g;
  });

  return <instancedMesh name="NestBuoy" ref={meshRef} args={[geometry, material, 1]} />;
}
