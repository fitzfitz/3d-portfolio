import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { flight, useSpaceStore } from "../../store/spaceStore";

const tunnelVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Scrolling streaks: thin bright lines racing along the tube, fading at both ends.
const tunnelFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  void main() {
    float lane = floor(vUv.x * 48.0);
    float laneRand = hash(lane);
    float speed = 2.2 + laneRand * 2.4;
    float phase = fract(vUv.y * (1.5 + laneRand) + uTime * speed + laneRand * 7.0);
    float streak = smoothstep(0.0, 0.12, phase) * smoothstep(0.5, 0.13, phase);
    float laneCenter = smoothstep(0.45, 0.0, abs(fract(vUv.x * 48.0) - 0.5));
    float endFade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
    vec3 col = mix(vec3(0.0, 0.94, 1.0), vec3(0.85, 0.98, 1.0), laneRand);
    gl_FragColor = vec4(col, streak * laneCenter * endFade * uIntensity * 0.75);
  }
`;

export default function WarpTunnel() {
  const meshRef = useRef<THREE.Mesh>(null);
  const intensity = useRef(0);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
        vertexShader: tunnelVertex,
        fragmentShader: tunnelFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const dt = Math.min(delta, 0.05);
    const target = useSpaceStore.getState().isWarping ? 1 : 0;
    intensity.current += (target - intensity.current) * (1 - Math.pow(0.002, dt)); // ~0.5s ease
    material.uniforms.uIntensity.value = intensity.current;
    material.uniforms.uTime.value = state.clock.getElapsedTime();

    const visible = intensity.current > 0.01;
    meshRef.current.visible = visible;
    if (visible) {
      meshRef.current.position.set(flight.x, flight.y, flight.z);
      // Follow both heading and pitch (R_y(heading)·R_x(π/2−pitch) on the cylinder's
      // +Y long axis == noseDirection(yaw, pitch)) — yaw-only left a pitched warp
      // flying out through the tunnel wall.
      meshRef.current.rotation.set(Math.PI / 2 - flight.pitch, flight.heading, 0, "YXZ");
    }
  });

  return (
    <mesh ref={meshRef} material={material} visible={false}>
      {/* open-ended tube around the ship, long axis = flight direction */}
      <cylinderGeometry args={[3.5, 3.5, 14, 32, 1, true]} />
    </mesh>
  );
}
