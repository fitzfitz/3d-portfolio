import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { setScannable } from "../../utils/scannables";

const TAIL_POINTS = 50;
interface CometDef { a: number; b: number; tiltY: number; periodSeconds: number; phase: number }
const COMETS: CometDef[] = [
  { a: 150, b: 95, tiltY: 18, periodSeconds: 140, phase: 0 },
  { a: 210, b: 130, tiltY: -14, periodSeconds: 220, phase: 2.1 },
];

const head = new THREE.Vector3();
const away = new THREE.Vector3();

export default function Comets() {
  const headRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const tailRefs = useRef<(THREE.Points<any> | null)[]>([null, null]);

  const { scene } = useGLTF("/models/comet_head.glb");

  const { headGeometry, headMaterial } = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    let m: THREE.MeshStandardMaterial | undefined;
    scene.traverse((o) => {
      if (!g && o instanceof THREE.Mesh) {
        g = o.geometry;
        // Clone before taming the glow: at the GLB's emissive 2.5, bloom
        // whites the tumbling icy chunk into a featureless ball.
        m = (o.material as THREE.MeshStandardMaterial).clone();
        m.emissiveIntensity = 1.05;
      }
    });
    return { headGeometry: g, headMaterial: m };
  }, [scene]);
  useEffect(() => () => headMaterial?.dispose(), [headMaterial]);

  const tails = useMemo(
    () =>
      COMETS.map(() => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TAIL_POINTS * 3), 3));
        geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TAIL_POINTS * 3), 3));
        // Per-particle flow state: each dot streams from the head toward the
        // tail tip and recycles — the tail shimmers instead of moving as a stamp.
        const particles = Array.from({ length: TAIL_POINTS }, () => ({
          phase: Math.random(),
          speed: 0.06 + Math.random() * 0.09, // full head->tip run in ~7-16s
          flick: 2 + Math.random() * 4,
          x: (Math.random() - 0.5), y: (Math.random() - 0.5), z: (Math.random() - 0.5),
        }));
        return { geom, particles };
      }),
    []
  );

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    const store = useSpaceStore.getState();
    let anyNear = false;

    COMETS.forEach((c, i) => {
      const ang = (time / c.periodSeconds) * Math.PI * 2 + c.phase;
      head.set(Math.cos(ang) * c.a, Math.sin(ang) * c.tiltY, Math.sin(ang) * c.b);
      setScannable("comet_" + i, head.x, head.y, head.z, "COMET_" + i);
      const mesh = headRefs.current[i];
      if (mesh) {
        mesh.position.copy(head);
        mesh.rotation.set(time * (0.4 + i * 0.17), time * (0.31 + i * 0.11), 0);
      }

      // Tail points away from the sun (origin), longer when closer to the sun
      away.copy(head).normalize();
      const distSun = head.length();
      const len = THREE.MathUtils.clamp(45 - distSun * 0.12, 8, 40);
      const tail = tailRefs.current[i];
      if (tail) {
        const posAttr = tail.geometry.attributes.position;
        const colAttr = tail.geometry.attributes.color;
        const data = posAttr.array as Float32Array;
        const cols = colAttr.array as Float32Array;
        const parts = tails[i].particles;
        for (let p = 0; p < TAIL_POINTS; p++) {
          const pt = parts[p];
          const f = (pt.phase + time * pt.speed) % 1; // flows head -> tip, recycles
          const spread = f * 3.2;
          data[p * 3] = head.x + away.x * f * len + pt.x * spread;
          data[p * 3 + 1] = head.y + away.y * f * len + pt.y * spread;
          data[p * 3 + 2] = head.z + away.z * f * len + pt.z * spread;
          // Bright near the head, dissolving toward the tip, with a shimmer
          const b = Math.pow(1 - f, 1.4) * (0.65 + 0.35 * Math.sin(time * pt.flick + pt.phase * 40));
          cols[p * 3] = b * 0.75;
          cols[p * 3 + 1] = b * 0.96;
          cols[p * 3 + 2] = b;
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
      }

      // xz-only by design — vertical NPC/comet reactions are out of scope (spec).
      const dx = head.x - flight.x;
      const dz = head.z - flight.z;
      if (dx * dx + dz * dz < 3600) anyNear = true;
    });

    store.setCometNear(anyNear);
  });

  return (
    <>
      {COMETS.map((_, i) => (
        <group key={i}>
          <mesh ref={(m) => { headRefs.current[i] = m; }} geometry={headGeometry} material={headMaterial} scale={0.8} />
          <points ref={(p) => { tailRefs.current[i] = p; }} geometry={tails[i].geom} frustumCulled={false}>
            <pointsMaterial vertexColors={true} size={0.55} transparent={true} opacity={0.9}
              blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation={true} />
          </points>
        </group>
      ))}
    </>
  );
}
