import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { JELLY_PATH, JELLY_NEAR_T, JELLY_LOOP_SECONDS } from "../../data/jellyfishPath";
import { isEditableTarget } from "../../hooks/useKeyboardInput";
import { setScannable } from "../../utils/scannables";

// Propulsion cycle (3.2s): slow refill, then a sharp contraction stroke.
// Mirrored in JS below for the swim surge — keep the two in sync.
const PULSE_GLSL = /* glsl */ `
  float pulseCycle(float t) {
    float c = fract(t / 3.2);
    return smoothstep(0.55, 0.68, c) * (1.0 - smoothstep(0.68, 0.95, c));
  }
`;

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying float vY;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vContract;
  ${""}
  ${PULSE_GLSL}
  void main() {
    vec3 p = position;
    float bell = smoothstep(-0.3, 0.5, p.y);
    float tent = 1.0 - smoothstep(-0.5, 0.1, p.y);
    float depth = max(0.0, -p.y);

    // Bell stroke: contract radially, stretch upward — a real swimming beat
    float contract = pulseCycle(uTime);
    p.xz *= 1.0 - bell * contract * 0.28;
    p.y += bell * contract * 0.35 * max(p.y, 0.0);

    // Tentacles: waves TRAVEL down the length (phase moves with -uTime),
    // amplitude grows toward the tips; secondary ripple adds organic detail
    p.x += tent * sin(p.y * 2.6 - uTime * 2.2) * 0.16 * depth;
    p.z += tent * cos(p.y * 1.7 - uTime * 1.5 + 1.3) * 0.16 * depth;
    p.x += tent * sin(p.y * 6.0 - uTime * 4.0) * 0.035 * depth;
    // Contraction draws the tentacles inward, trailing the bell
    p.xz *= 1.0 - tent * pulseCycle(uTime - 0.35) * 0.14;

    vY = position.y;
    vContract = contract;
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
  varying float vContract;
  void main() {
    float fresnel = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0), 1.8);
    vec3 cyan = vec3(0.0, 0.94, 1.0);
    vec3 magenta = vec3(0.93, 0.28, 0.6);
    vec3 col = mix(cyan, magenta, 0.5 + 0.5 * sin(uTime * 0.5 + vY * 0.8));
    // Bioluminescent rings pulsing DOWN the body — the strongest "alive" cue
    float ring = smoothstep(0.78, 1.0, sin(vY * 2.4 - uTime * 2.4));
    // Rim brightens on each contraction stroke
    float rim = fresnel * (0.55 + 0.45 * vContract);
    float core = smoothstep(0.0, 0.8, vY) * (0.30 + 0.25 * vContract);
    gl_FragColor = vec4(col + ring * vec3(0.5, 0.9, 1.0) * 0.5, rim + ring * 0.25 + core * 0.3);
  }
`;

// JS mirror of pulseCycle for the swim surge
function pulseCycle(t: number): number {
  const c = ((t / 3.2) % 1 + 1) % 1;
  const up = THREE.MathUtils.smoothstep(c, 0.55, 0.68);
  const down = 1 - THREE.MathUtils.smoothstep(c, 0.68, 0.95);
  return up * down;
}

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
    // Jet propulsion: surge forward on each contraction stroke, plus a slow bob —
    // the drift is no longer a constant glide.
    const surge = pulseCycle(time - 0.15);
    groupRef.current.position.addScaledVector(tangent, surge * 2.2);
    groupRef.current.position.y += Math.sin(time * 0.5) * 0.8;
    groupRef.current.rotation.set(
      tangent.z * 0.12 + Math.sin(time * 0.31) * 0.06,
      Math.sin(time * 0.23) * 0.25,
      -tangent.x * 0.12 + Math.cos(time * 0.27) * 0.06
    );
    setScannable("jellyfish", groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z, "UNKNOWN_LIFEFORM");
  });

  return (
    <group ref={groupRef} scale={6}>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}
