import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { flight, useSpaceStore } from "../../store/spaceStore";

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

  const tails = useMemo(
    () =>
      COMETS.map(() => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TAIL_POINTS * 3), 3));
        const jitter = Array.from({ length: TAIL_POINTS }, () => ({
          x: (Math.random() - 0.5), y: (Math.random() - 0.5), z: (Math.random() - 0.5),
        }));
        return { geom, jitter };
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
      const mesh = headRefs.current[i];
      if (mesh) mesh.position.copy(head);

      // Tail points away from the sun (origin), longer when closer to the sun
      away.copy(head).normalize();
      const distSun = head.length();
      const len = THREE.MathUtils.clamp(45 - distSun * 0.12, 8, 40);
      const tail = tailRefs.current[i];
      if (tail) {
        const attr = tail.geometry.attributes.position;
        const data = attr.array as Float32Array;
        const jit = tails[i].jitter;
        for (let p = 0; p < TAIL_POINTS; p++) {
          const f = p / TAIL_POINTS;
          const spread = f * 3.2;
          data[p * 3] = head.x + away.x * f * len + jit[p].x * spread;
          data[p * 3 + 1] = head.y + away.y * f * len + jit[p].y * spread;
          data[p * 3 + 2] = head.z + away.z * f * len + jit[p].z * spread;
        }
        attr.needsUpdate = true;
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
          <mesh ref={(m) => { headRefs.current[i] = m; }}>
            <sphereGeometry args={[0.8, 12, 12]} />
            <meshStandardMaterial color="#eaffff" emissive="#bff5ff" emissiveIntensity={2.6} />
          </mesh>
          <points ref={(p) => { tailRefs.current[i] = p; }} geometry={tails[i].geom} frustumCulled={false}>
            <pointsMaterial color="#bff5ff" size={0.5} transparent={true} opacity={0.55}
              blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation={true} />
          </points>
        </group>
      ))}
    </>
  );
}
