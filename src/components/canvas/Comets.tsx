import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF, Trail } from "@react-three/drei";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { setScannable } from "../../utils/scannables";
import { keplerPosition } from "../../utils/kepler";

const TAIL_POINTS = 50;
// Keplerian orbits: sun at the focus — comets whip past perihelion (~54 units,
// tail blazing) and crawl out to aphelion. Short periods = fast, frequent sweeps.
const COMETS = [
  { a: 140, e: 0.62, periodSeconds: 170, phase: 0, tilt: 0.18 },
  { a: 155, e: 0.65, periodSeconds: 260, phase: 2.1, tilt: -0.14 },
];

const head = new THREE.Vector3();
const away = new THREE.Vector3();
const velDir = new THREE.Vector3();
const Y_UP = new THREE.Vector3(0, 1, 0);

// "Fire beam" coma: flickering fresnel shell, warm core fading to icy fringe.
const comaVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const comaFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float rim = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0), 1.5);
    float flick = 0.72 + 0.28 * sin(uTime * 9.0 + vNormal.x * 7.0) * sin(uTime * 6.3 + vNormal.y * 5.0);
    vec3 col = mix(vec3(1.0, 0.72, 0.35), vec3(0.72, 0.95, 1.0), rim); // warm core -> icy fringe
    gl_FragColor = vec4(col, rim * flick * 0.85);
  }
`;

// Velocity-aligned energy beam: a flaring open cylinder trailing the head,
// white-hot at the nose dissolving to cyan — length/brightness ride the
// comet's actual orbital speed (longest at perihelion).
const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  varying vec2 vUv;
  void main() {
    float fade = pow(1.0 - vUv.y, 1.7);
    float streak = 0.82 + 0.18 * sin(uTime * 21.0 + vUv.y * 26.0 + vUv.x * 40.0);
    vec3 col = mix(vec3(1.0, 1.0, 1.0), vec3(0.45, 0.85, 1.0), clamp(vUv.y * 1.6, 0.0, 1.0));
    gl_FragColor = vec4(col, fade * streak * uPower);
  }
`;

export default function Comets() {
  const headRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const comaRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const tailRefs = useRef<(THREE.Points<any> | null)[]>([null, null]);
  const beamRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const prevHeads = useRef([new THREE.Vector3(), new THREE.Vector3()]);
  const beamInit = useRef([false, false]);

  const comaMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: comaVertex,
        fragmentShader: comaFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  );
  useEffect(() => () => comaMaterial.dispose(), [comaMaterial]);

  // One beam material per comet — each drives its own uPower from orbital speed.
  const beamMaterials = useMemo(
    () =>
      COMETS.map(
        () =>
          new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uPower: { value: 0 } },
            vertexShader: beamVertex,
            fragmentShader: beamFragment,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
      ),
    []
  );
  useEffect(() => () => beamMaterials.forEach((m) => m.dispose()), [beamMaterials]);

  const { scene } = useGLTF("/models/comet_head.glb");

  const { headGeometry, headMaterial } = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    let m: THREE.MeshStandardMaterial | undefined;
    scene.traverse((o) => {
      if (!g && o instanceof THREE.Mesh) {
        g = o.geometry;
        // Baked rocky-ice material ships in the GLB now (no emissive) — the
        // coma shell provides the glow. Clone so disposal stays component-owned.
        m = (o.material as THREE.MeshStandardMaterial).clone();
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

  useFrame((state, delta) => {
    const time = state.clock.getElapsedTime();
    const store = useSpaceStore.getState();
    comaMaterial.uniforms.uTime.value = time;
    let anyNear = false;

    COMETS.forEach((c, i) => {
      const kp = keplerPosition(time, c);
      head.set(kp.x, kp.y, kp.z);
      setScannable("comet_" + i, head.x, head.y, head.z, "COMET_" + i);
      const mesh = headRefs.current[i];
      if (mesh) {
        mesh.position.copy(head);
        mesh.rotation.set(time * (0.4 + i * 0.17), time * (0.31 + i * 0.11), 0);
      }
      const coma = comaRefs.current[i];
      if (coma) coma.position.copy(head);

      // Speed beam: orient a flaring shaft opposite the velocity, length and
      // brightness scaling with how fast the comet is actually moving.
      const prev = prevHeads.current[i];
      const beam = beamRefs.current[i];
      if (!beamInit.current[i]) {
        prev.copy(head);
        beamInit.current[i] = true;
      } else if (beam && delta > 0) {
        velDir.copy(head).sub(prev);
        const speed = velDir.length() / delta;
        prev.copy(head);
        if (velDir.lengthSq() > 1e-8) {
          velDir.normalize().negate(); // points backwards, along the beam
          const len = THREE.MathUtils.clamp(speed * 1.6, 7, 34);
          beam.position.copy(head).addScaledVector(velDir, len / 2 + 1.0);
          beam.quaternion.setFromUnitVectors(Y_UP, velDir);
          beam.scale.set(1, len, 1);
          beamMaterials[i].uniforms.uPower.value = THREE.MathUtils.clamp(speed / 9, 0.35, 1.0);
          beamMaterials[i].uniforms.uTime.value = time;
        }
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
          {/* Ribbon trail like the ship's engine wake — long at perihelion speed */}
          <Trail width={4.4} length={11} color="#9feaff" attenuation={(t) => t * t}>
            <mesh ref={(m) => { headRefs.current[i] = m; }} geometry={headGeometry} material={headMaterial} scale={0.8} />
          </Trail>
          {/* Fire coma */}
          <mesh ref={(m) => { comaRefs.current[i] = m; }} material={comaMaterial} scale={1.5}>
            <sphereGeometry args={[1, 20, 20]} />
          </mesh>
          {/* Speed beam: flaring shaft opposite the velocity vector */}
          <mesh ref={(m) => { beamRefs.current[i] = m; }} material={beamMaterials[i]} frustumCulled={false}>
            <cylinderGeometry args={[0.85, 0.3, 1, 12, 1, true]} />
          </mesh>
          {/* Anti-sunward shimmer stream (the ion tail) */}
          <points ref={(p) => { tailRefs.current[i] = p; }} geometry={tails[i].geom} frustumCulled={false}>
            <pointsMaterial vertexColors={true} size={0.55} transparent={true} opacity={0.9}
              blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation={true} />
          </points>
        </group>
      ))}
    </>
  );
}
