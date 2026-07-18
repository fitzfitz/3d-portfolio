import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { JELLY_PATH, JELLY_NEAR_T, JELLY_LOOP_SECONDS } from "../../data/jellyfishPath";
import { isEditableTarget } from "../../hooks/useKeyboardInput";

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
    let src: THREE.Mesh | undefined;
    scene.traverse((o) => {
      if (!src && o instanceof THREE.Mesh) src = o;
    });
    if (!src) throw new Error("creature.glb contains no mesh");
    // Bake the node's dequantization transform (KHR_mesh_quantization) so the
    // shader's y-based masks operate on authored coordinates, and regeneration
    // can't silently rescale the creature.
    src.updateMatrix();
    const g = src.geometry.clone();
    g.applyMatrix4(src.matrix);
    return g;
  }, [scene]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Debug/easter-egg summon: J fast-forwards the loop phase so the jelly appears nearby.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyJ") return;
      const t = e.target as HTMLElement | null;
      if (isEditableTarget(t)) return;
      const now = timeRef.current;
      tOffset.current = JELLY_NEAR_T - ((now / JELLY_LOOP_SECONDS) % 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.getElapsedTime();
    timeRef.current = time;
    material.uniforms.uTime.value = time;
    const t = ((time / JELLY_LOOP_SECONDS + tOffset.current) % 1 + 1) % 1;
    JELLY_PATH.getPointAt(t, groupRef.current.position);
    const tangent = JELLY_PATH.getTangentAt(t);
    groupRef.current.rotation.set(tangent.z * 0.12, 0, -tangent.x * 0.12); // gentle tilt into drift
  });

  return (
    <group ref={groupRef} scale={6}>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}
