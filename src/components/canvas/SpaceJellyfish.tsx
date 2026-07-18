import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

const LOOP_SECONDS = 400;
const NEAR_T = 0.177; // numerically computed closest-approach phase (~75 units from center)

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying float vY;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec3 p = position;
    float bell = smoothstep(-0.2, 1.0, p.y);
    float tent = 1.0 - smoothstep(-0.2, 0.6, p.y);
    float pulse = sin(uTime * 1.6) * 0.5 + 0.5;
    p.xz *= 1.0 + bell * (pulse * 0.18 - 0.09);
    p.y += bell * sin(uTime * 1.6 + 1.2) * 0.08;
    float depth = max(0.0, -p.y);
    p.x += tent * sin(uTime * 1.1 + p.y * 1.4) * 0.12 * depth;
    p.z += tent * cos(uTime * 0.9 + p.y * 1.7) * 0.12 * depth;
    vY = p.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying float vY;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float fresnel = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0), 1.8);
    vec3 cyan = vec3(0.0, 0.94, 1.0);
    vec3 magenta = vec3(0.93, 0.28, 0.6);
    vec3 col = mix(cyan, magenta, 0.5 + 0.5 * sin(uTime * 0.5 + vY * 0.8));
    float core = smoothstep(0.2, 1.0, vY) * (0.35 + 0.25 * sin(uTime * 2.2));
    gl_FragColor = vec4(col, fresnel * 0.65 + core * 0.3);
  }
`;

// Far drifting loop; two segments pass within sight of the play area.
const PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(300, 40, 0),
    new THREE.Vector3(30, 18, 70),
    new THREE.Vector3(-320, 10, 120),
    new THREE.Vector3(-120, 55, -300),
    new THREE.Vector3(120, 20, -140),
  ],
  true,
  "catmullrom",
  0.6
);

export default function SpaceJellyfish() {
  const { scene } = useGLTF("/models/creature.glb");
  const groupRef = useRef<THREE.Group>(null);
  const tOffset = useRef(0);
  const timeRef = useRef(0);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  const geometry = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    scene.traverse((o) => {
      if (!g && o instanceof THREE.Mesh) g = o.geometry;
    });
    if (!g) throw new Error("creature.glb contains no mesh");
    return g;
  }, [scene]);

  // Debug/easter-egg summon: J fast-forwards the loop phase so the jelly appears nearby.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyJ") return;
      const now = timeRef.current;
      tOffset.current = NEAR_T - ((now / LOOP_SECONDS) % 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.getElapsedTime();
    timeRef.current = time;
    material.uniforms.uTime.value = time;
    const t = ((time / LOOP_SECONDS + tOffset.current) % 1 + 1) % 1;
    PATH.getPointAt(t, groupRef.current.position);
    const tangent = PATH.getTangentAt(t);
    groupRef.current.rotation.set(tangent.z * 0.12, 0, -tangent.x * 0.12); // gentle tilt into drift
  });

  return (
    <group ref={groupRef} scale={18}>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}
