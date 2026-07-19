import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { setScannable } from "../../utils/scannables";
import { keplerPosition } from "../../utils/kepler";

// Realistic comet per docs/superpowers/specs/2026-07-19-realistic-comet-spec.md:
// coal-dark bilobed nucleus, green C2 coma, straight blue anti-sunward ion
// tail, curved white dust tail, all activity scaled by heliocentric distance.
const COMETS = [
  { a: 140, e: 0.62, periodSeconds: 170, phase: 0, tilt: 0.18 },
  { a: 155, e: 0.65, periodSeconds: 260, phase: 2.1, tilt: -0.14 },
];

const ION_POINTS = 72;
const DUST_POINTS = 70;
const DUST_MAX_AGE = 10; // seconds of emission history sampled along the orbit

// Soft round sprite so tail particles read as diffuse gas/dust, not squares.
const particleSprite = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(canvas);
})();

const head = new THREE.Vector3();
const away = new THREE.Vector3();
const perp1 = new THREE.Vector3();
const perp2 = new THREE.Vector3();
const emitted = new THREE.Vector3();
const Y_UP = new THREE.Vector3(0, 1, 0);

/** Activity ∝ 1/r² heliocentric distance (spec C3): ~1.2 at perihelion (r≈53), ~0.07 at aphelion. */
const activityAt = (distSun: number) => Math.min(1.2, (60 / Math.max(distSun, 1)) * (60 / Math.max(distSun, 1)));

// C2 (dicarbon) fluorescence coma: green, diffuse, confined to the head (C1, C4).
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
  uniform float uAct;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float facing = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
    // Diffuse gas ball: densest toward the center line of sight, soft rim falloff
    float density = pow(facing, 1.6);
    float flick = 0.85 + 0.15 * sin(uTime * 3.1 + vNormal.x * 5.0) * sin(uTime * 2.3 + vNormal.y * 4.0);
    vec3 col = mix(vec3(0.30, 0.95, 0.48), vec3(0.75, 1.0, 0.85), density * 0.35); // C2 green
    gl_FragColor = vec4(col, density * flick * uAct * 0.55);
  }
`;

export default function Comets() {
  const headRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const comaRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const ionRefs = useRef<(THREE.Points<THREE.BufferGeometry<THREE.NormalBufferAttributes>> | null)[]>([null, null]);
  const dustRefs = useRef<(THREE.Points<THREE.BufferGeometry<THREE.NormalBufferAttributes>> | null)[]>([null, null]);

  // One coma material per comet — each drives uAct from its own solar distance.
  const comaMaterials = useMemo(
    () =>
      COMETS.map(
        () =>
          new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uAct: { value: 0 } },
            vertexShader: comaVertex,
            fragmentShader: comaFragment,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide,
            depthWrite: false,
          })
      ),
    []
  );
  useEffect(() => () => comaMaterials.forEach((m) => m.dispose()), [comaMaterials]);

  const { scene } = useGLTF("/models/comet_head.glb");

  const { headGeometry, headMaterial } = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    let m: THREE.MeshStandardMaterial | undefined;
    scene.traverse((o) => {
      if (!g && o instanceof THREE.Mesh) {
        g = o.geometry;
        m = (o.material as THREE.MeshStandardMaterial).clone();
      }
    });
    return { headGeometry: g, headMaterial: m };
  }, [scene]);
  useEffect(() => () => headMaterial?.dispose(), [headMaterial]);

  // Ion tail (I1-I4): straight, narrow, blue — particles race anti-sunward.
  const ions = useMemo(
    () =>
      COMETS.map(() => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ION_POINTS * 3), 3));
        geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(ION_POINTS * 3), 3));
        const particles = Array.from({ length: ION_POINTS }, () => ({
          phase: Math.random(),
          speed: 0.25 + Math.random() * 0.2, // ions are fast (solar wind pickup)
          kink: Math.random() * Math.PI * 2,
          jx: (Math.random() - 0.5) * 0.5,
          jy: (Math.random() - 0.5) * 0.5,
        }));
        return { geom, particles };
      }),
    []
  );

  // Dust tail (D1-D4): each grain was emitted τ seconds ago at the comet's
  // past orbital position, then pushed anti-sunward by radiation pressure
  // (drift ∝ τ²) — producing the classic broad curved tail from real physics.
  const dusts = useMemo(
    () =>
      COMETS.map(() => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DUST_POINTS * 3), 3));
        geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(DUST_POINTS * 3), 3));
        const particles = Array.from({ length: DUST_POINTS }, () => ({
          lag: Math.random(), // fraction of DUST_MAX_AGE
          beta: 0.25 + Math.random() * 0.25, // radiation-pressure strength per grain size
          sx: (Math.random() - 0.5), sy: (Math.random() - 0.5), sz: (Math.random() - 0.5),
          flick: 1 + Math.random() * 2,
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
      const kp = keplerPosition(time, c);
      head.set(kp.x, kp.y, kp.z);
      setScannable("comet_" + i, head.x, head.y, head.z, "COMET_" + i);

      const distSun = head.length();
      const act = activityAt(distSun);
      away.copy(head).normalize(); // anti-sunward (sun at origin)
      perp1.crossVectors(away, Y_UP);
      if (perp1.lengthSq() < 1e-6) perp1.set(1, 0, 0);
      perp1.normalize();
      perp2.crossVectors(away, perp1);

      // Nucleus: slow tumble (N5)
      const mesh = headRefs.current[i];
      if (mesh) {
        mesh.position.copy(head);
        mesh.rotation.set(time * 0.05 + i, time * 0.08 + i * 2.1, 0);
      }

      // Coma: green envelope, size + brightness ride activity (C1-C3)
      const coma = comaRefs.current[i];
      if (coma) {
        coma.position.copy(head);
        coma.scale.setScalar(1.1 * (2.0 + 3.5 * act));
      }
      comaMaterials[i].uniforms.uTime.value = time;
      comaMaterials[i].uniforms.uAct.value = act;

      // Ion tail: straight anti-sunward shaft with solar-wind ripples (I1-I4)
      const ionLen = 18 + 55 * act;
      const ion = ionRefs.current[i];
      if (ion) {
        const posAttr = ion.geometry.attributes.position;
        const colAttr = ion.geometry.attributes.color;
        const data = posAttr.array as Float32Array;
        const cols = colAttr.array as Float32Array;
        const parts = ions[i].particles;
        for (let p = 0; p < ION_POINTS; p++) {
          const pt = parts[p];
          const f = (pt.phase + time * pt.speed) % 1;
          const d = f * ionLen;
          const wave = Math.sin(f * 16 - time * 4.5 + pt.kink) * 0.55 * f;
          data[p * 3] = head.x + away.x * d + perp1.x * (wave + pt.jx * f) + perp2.x * pt.jy * f;
          data[p * 3 + 1] = head.y + away.y * d + perp1.y * (wave + pt.jx * f) + perp2.y * pt.jy * f;
          data[p * 3 + 2] = head.z + away.z * d + perp1.z * (wave + pt.jx * f) + perp2.z * pt.jy * f;
          const b = Math.min(1.2, Math.pow(1 - f, 1.2) * act * 1.5);
          cols[p * 3] = b * 0.35;      // CO+ blue — never green (C4)
          cols[p * 3 + 1] = b * 0.55;
          cols[p * 3 + 2] = b;
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
      }

      // Dust tail: emitted along past orbit + radiation-pressure drift (D1-D4)
      const dust = dustRefs.current[i];
      if (dust) {
        const posAttr = dust.geometry.attributes.position;
        const colAttr = dust.geometry.attributes.color;
        const data = posAttr.array as Float32Array;
        const cols = colAttr.array as Float32Array;
        const parts = dusts[i].particles;
        for (let p = 0; p < DUST_POINTS; p++) {
          const pt = parts[p];
          const tau = pt.lag * DUST_MAX_AGE;
          const ke = keplerPosition(time - tau, c);
          emitted.set(ke.x, ke.y, ke.z);
          const drift = 0.5 * pt.beta * tau * tau; // anti-sunward push ∝ age²
          const spread = 0.3 + tau * 0.22; // tail broadens with age (D1 "broad")
          const dirLen = emitted.length() || 1;
          data[p * 3] = emitted.x + (emitted.x / dirLen) * drift + pt.sx * spread;
          data[p * 3 + 1] = emitted.y + (emitted.y / dirLen) * drift + pt.sy * spread;
          data[p * 3 + 2] = emitted.z + (emitted.z / dirLen) * drift + pt.sz * spread;
          const b = Math.pow(1 - pt.lag, 1.2) * act * (0.8 + 0.2 * Math.sin(time * pt.flick + pt.lag * 30));
          cols[p * 3] = b;             // sunlight white with a warm cast (D2)
          cols[p * 3 + 1] = b * 0.96;
          cols[p * 3 + 2] = b * 0.86;
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
          {/* Coal-dark bilobed nucleus (N1-N4 baked in the GLB) */}
          <mesh ref={(m) => { headRefs.current[i] = m; }} geometry={headGeometry} material={headMaterial} scale={0.9} />
          {/* Green C2 coma */}
          <mesh ref={(m) => { comaRefs.current[i] = m; }} material={comaMaterials[i]}>
            <sphereGeometry args={[1, 24, 24]} />
          </mesh>
          {/* Blue ion tail — straight, anti-sunward */}
          <points ref={(p) => { ionRefs.current[i] = p as THREE.Points<THREE.BufferGeometry<THREE.NormalBufferAttributes>> | null; }} geometry={ions[i].geom} frustumCulled={false}>
            <pointsMaterial vertexColors={true} size={0.95} map={particleSprite} transparent={true} opacity={0.9}
              blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation={true} />
          </points>
          {/* White dust tail — broad, curved along the orbit */}
          <points ref={(p) => { dustRefs.current[i] = p as THREE.Points<THREE.BufferGeometry<THREE.NormalBufferAttributes>> | null; }} geometry={dusts[i].geom} frustumCulled={false}>
            <pointsMaterial vertexColors={true} size={1.4} map={particleSprite} transparent={true} opacity={0.8}
              blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation={true} />
          </points>
        </group>
      ))}
    </>
  );
}
