import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ATMOSPHERE_VERT, makeAtmosphereMaterial } from "./atmosphereMaterial";

interface AtmosphereProps {
  radius: number;
  color: string;
  /**
   * Planet's world position — the sun sits at the origin. The planet orbits,
   * so this is the same mutable `bodies[name]` object SpacePlanets writes
   * every frame (not a fresh array), read here each frame so the Rayleigh
   * gradient keeps pointing at the origin as the planet moves.
   */
  planetPos?: { x: number; y: number; z: number };
  /** overall strength at 1 AU; earth-like ~1, thin mars haze ~0.4 */
  intensity?: number;
  /**
   * The planet's orbit radius. The rim is scattered sunlight (L27), so it is
   * scaled by the sunlight there, (AU / r)² (L19). Orbits are circles, so this
   * is fixed per planet: a uniform value, set once. Omit for 1 AU.
   */
  orbitRadius?: number;
  /** shell thickness multiplier (1.12 = earth-like, 1.05 = thin haze) */
  thickness?: number;
  /** The terminator band's tint; omit for the sunset orange (atmosphereMaterial.ts). */
  dusk?: THREE.ColorRepresentation;
}

/** Sun-aware fresnel scattering shell. Place inside a planet group. */
export default function Atmosphere({ radius, color, planetPos, intensity = 1.15, thickness = 1.12, orbitRadius, dusk }: AtmosphereProps) {
  const material = useMemo(
    () => makeAtmosphereMaterial({ color, planetPos, intensity, thickness, orbitRadius, dusk }),
    // planetPos is a stable mutated-in-place object; only its identity (not
    // its contents) should retrigger material creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [color, intensity, thickness, orbitRadius, dusk],
  );

  // Planet moves every frame (SpacePlanets writes into the same object) — the
  // sun-facing gradient must track it live rather than freeze at mount time.
  useFrame(() => {
    if (!planetPos) return;
    (material.uniforms.uSunDir.value as THREE.Vector3)
      .set(-planetPos.x, -planetPos.y, -planetPos.z)
      .normalize();
  });

  return (
    <mesh material={material}>
      <sphereGeometry args={[radius * thickness, 32, 32]} />
    </mesh>
  );
}

const limbFragment = /* glsl */ `
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldNormal;
  void main() {
    float rim = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0), 1.6);
    gl_FragColor = vec4(0.0, 0.0, 0.0, rim * uStrength);
  }
`;

/** Gas-giant limb darkening: the disk dims toward the edge (deeper atmosphere
 * path = more absorption) — the visual signature that separates a gas giant
 * from a rocky body. Normal-blended dark fresnel overlay. */
export function LimbDarkening({ radius, strength = 0.75 }: { radius: number; strength?: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uStrength: { value: strength } },
        vertexShader: ATMOSPHERE_VERT,
        fragmentShader: limbFragment,
        transparent: true,
        side: THREE.FrontSide,
        depthWrite: false,
      }),
    [strength]
  );
  return (
    <mesh material={material}>
      <sphereGeometry args={[radius * 1.005, 32, 32]} />
    </mesh>
  );
}
