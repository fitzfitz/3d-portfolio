import { useRef, useMemo, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSpaceStore } from "../../store/spaceStore";
import { ambientTime } from "../../utils/ambientTime";

/**
 * Core emissive baseline and pulse depth. 3.2 matches the value the material is
 * authored with, so with the pulse at zero the sun looks exactly as it did.
 * ±0.25 is ~8% — a visible breath at a glance, but small enough that the bloom
 * threshold (0.2, see GlobalCanvas) does not visibly bloom-pump with it.
 */
const SUN_CORE_EMISSIVE = 3.2;
const SUN_CORE_PULSE = 0.25;

const coronaVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

// Cheap animated value noise: two scrolling sine fields beat against each other.
const coronaFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  float vnoise(vec3 p) {
    return sin(p.x * 5.1 + uTime * 1.7) * sin(p.y * 4.3 - uTime * 1.1) * sin(p.z * 6.7 + uTime * 2.3);
  }
  void main() {
    // clamp: |dot| can exceed 1.0 by float epsilon and pow(negative, x) is NaN on some GPUs
    float rim = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0), 2.0);
    float n = 0.5 + 0.5 * vnoise(vNormal * 2.0);
    float flicker = 0.65 + 0.35 * vnoise(vNormal * 4.0 + vec3(0.0, uTime * 0.2, 0.0));
    vec3 col = mix(vec3(1.0, 0.33, 0.0), vec3(1.0, 0.75, 0.35), n);
    gl_FragColor = vec4(col, rim * flicker * 0.85);
  }
`;

/** Shared soft radial flare texture (canvas-generated once). */
const flareTexture = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255, 220, 160, 0.85)");
    g.addColorStop(0.35, "rgba(255, 130, 40, 0.35)");
    g.addColorStop(1, "rgba(255, 85, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
})();

interface SunProps {
  onSunReady: (mesh: THREE.Mesh) => void;
}

export default function Sun({ onSunReady }: SunProps) {
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const flareARef = useRef<THREE.Sprite>(null);
  const flareBRef = useRef<THREE.Sprite>(null);

  const coronaMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: coronaVertex,
        fragmentShader: coronaFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  );

  // The core mesh, held for per-frame access. `coreRef` below is a *callback*
  // ref (it notifies the parent for the GodRays pass), so it has no `.current`
  // — this is the handle the frame loop needs.
  const coreMesh = useRef<THREE.Mesh | null>(null);

  // Callback ref: fires once when the core mesh mounts.
  const coreRef = useCallback(
    (mesh: THREE.Mesh | null) => {
      coreMesh.current = mesh;
      if (mesh) onSunReady(mesh);
    },
    [onSunReady]
  );

  useFrame((state) => {
    const t = ambientTime(state.clock.getElapsedTime());
    coronaMaterial.uniforms.uTime.value = t;
    // Core breathing. The corona, flares and god rays are ALL gated behind
    // !isLowPerf, so without this the sun — dead centre of the scene — was
    // 100% frozen for exactly the visitors on modest hardware who land in
    // low-perf mode. Driving emissiveIntensity rather than scale because the
    // GodRays pass samples this mesh's silhouette, and a pulsing silhouette
    // would make the rays throb. ~18s period (2pi/0.35) puts it in the same
    // tempo family as the flare pulses above (0.53-2.7 rad/s), so it reads as
    // one organism rather than a bolted-on effect.
    if (coreMesh.current) {
      const mat = coreMesh.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = SUN_CORE_EMISSIVE + Math.sin(t * 0.35) * SUN_CORE_PULSE;
    }
    // Asynchronous flare pulses
    if (flareARef.current) {
      const s = 9 + Math.sin(t * 0.9) * 1.4 + Math.sin(t * 2.7) * 0.7;
      flareARef.current.scale.set(s, s, 1);
    }
    if (flareBRef.current) {
      const s = 13 + Math.sin(t * 0.53 + 2.1) * 2.0;
      flareBRef.current.scale.set(s, s, 1);
      (flareBRef.current.material as THREE.SpriteMaterial).opacity = 0.4 + 0.15 * Math.sin(t * 1.3 + 1.0);
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Core (this mesh feeds the GodRays pass) */}
      <mesh ref={coreRef} rotation={[0, 0, 0]}>
        <sphereGeometry args={[2.5, 32, 32]} />
        <meshStandardMaterial color="#ff5500" emissive="#ff3300" emissiveIntensity={3.2} roughness={0.15} metalness={0.1} />
      </mesh>

      {/* Animated corona shell + flares (skipped in low-perf) */}
      {!isLowPerf && (
        <>
          <mesh name="SunCorona" material={coronaMaterial}>
            <sphereGeometry args={[3.2, 48, 48]} />
          </mesh>
          <sprite ref={flareARef}>
            <spriteMaterial map={flareTexture} transparent={true} opacity={0.55}
              blending={THREE.AdditiveBlending} depthWrite={false} />
          </sprite>
          <sprite ref={flareBRef}>
            <spriteMaterial map={flareTexture} transparent={true} opacity={0.4}
              blending={THREE.AdditiveBlending} depthWrite={false} />
          </sprite>
        </>
      )}

      {/* Solar system light (moved verbatim from SpacePlanets) */}
      <pointLight color="#ffffff" intensity={4.8} distance={450} decay={0.8} castShadow={true} />
    </group>
  );
}
