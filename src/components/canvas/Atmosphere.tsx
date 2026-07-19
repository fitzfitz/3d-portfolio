import { useMemo } from "react";
import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldNormal;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSunDir;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldNormal;
  void main() {
    // clamp: |dot| can exceed 1.0 by float epsilon and pow(negative, x) is NaN on some GPUs
    float fresnel = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0), 3.0);
    // Scattering needs sunlight: bright on the lit limb, dying past the terminator
    float lit = clamp(dot(normalize(vWorldNormal), uSunDir), 0.0, 1.0);
    gl_FragColor = vec4(uColor, fresnel * (0.25 + 0.85 * lit) * uIntensity);
  }
`;

interface AtmosphereProps {
  radius: number;
  color: string;
  /** planet's world position — the sun sits at the origin */
  planetPos?: [number, number, number];
  /** overall strength; earth-like ~1, thin mars haze ~0.4 */
  intensity?: number;
  /** shell thickness multiplier (1.12 = earth-like, 1.05 = thin haze) */
  thickness?: number;
}

/** Sun-aware fresnel scattering shell. Place inside a planet group. */
export default function Atmosphere({ radius, color, planetPos, intensity = 1.15, thickness = 1.12 }: AtmosphereProps) {
  const material = useMemo(() => {
    const sunDir = planetPos
      ? new THREE.Vector3(-planetPos[0], -planetPos[1], -planetPos[2]).normalize()
      : new THREE.Vector3(0, 1, 0);
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uSunDir: { value: sunDir },
        uIntensity: { value: intensity },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
  }, [color, planetPos, intensity]);
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
        vertexShader,
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
