import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { gameTime } from "../../utils/ambientTime";

const tunnelVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Hyperspace streaks: long, hair-thin lines racing along a wide, long tube
// that encloses the camera, so they converge on the vanishing point ahead.
// The old tube was 3.5u wide and 14u long around the ship — seen from the
// chase camera down its short end, its streaks read as a ring of confetti.
const tunnelFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  void main() {
    float lanes = 140.0;
    float lane = floor(vUv.x * lanes);
    float laneRand = hash(lane);
    // Only some lanes carry a streak at all: sparse reads as speed, dense as a wall.
    // ("active" is a reserved word in GLSL ES: fails to compile on many GPUs.)
    float laneOn = step(0.45, hash(lane + 17.0));
    float speed = 1.6 + laneRand * 1.8;
    float phase = fract(vUv.y * (0.8 + laneRand * 0.6) + uTime * speed + laneRand * 7.0);
    // Long tail, sharp head.
    float streak = smoothstep(0.0, 0.42, phase) * smoothstep(0.5, 0.44, phase);
    float laneCenter = smoothstep(0.32, 0.0, abs(fract(vUv.x * lanes) - 0.5));
    float endFade = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
    vec3 col = mix(vec3(0.55, 0.9, 1.0), vec3(1.0), laneRand * 0.6);
    gl_FragColor = vec4(col, laneOn * streak * laneCenter * endFade * uIntensity * 0.85);
  }
`;

/** Tunnel is centred this far ahead of the ship, so the camera sits inside its rear section. */
const TUNNEL_AHEAD = 24;

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
    // gameTime, not a raw clock read: the shader's scrolling streaks would
    // otherwise phase-pop on every THREE.Clock reset (Task 6's dossier
    // freeze) — see utils/ambientTime.ts's gameTime() doc comment. Warp is
    // user-initiated, same as PlasmaAnomalies, so this stays off ambientTime
    // (which freezes under reduced motion) too.
    material.uniforms.uTime.value = gameTime(state.clock.getElapsedTime());

    const visible = intensity.current > 0.01;
    meshRef.current.visible = visible;
    if (visible) {
      // Centred ahead along the nose (same convention as noseDirection).
      const cp = Math.cos(flight.pitch);
      meshRef.current.position.set(
        flight.x + Math.sin(flight.heading) * cp * TUNNEL_AHEAD,
        flight.y + Math.sin(flight.pitch) * TUNNEL_AHEAD,
        flight.z + Math.cos(flight.heading) * cp * TUNNEL_AHEAD,
      );
      // Follow both heading and pitch (R_y(heading)·R_x(π/2−pitch) on the cylinder's
      // +Y long axis == noseDirection(yaw, pitch)) — yaw-only left a pitched warp
      // flying out through the tunnel wall.
      meshRef.current.rotation.set(Math.PI / 2 - flight.pitch, flight.heading, 0, "YXZ");
    }
  });

  return (
    <mesh name="WarpTunnel" ref={meshRef} material={material} visible={false}>
      {/* open-ended tube enclosing ship and camera, long axis = flight direction */}
      <cylinderGeometry args={[11, 11, 80, 64, 1, true]} />
    </mesh>
  );
}
