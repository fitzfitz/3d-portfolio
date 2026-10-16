import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { irradianceVsAU } from "../../utils/sunLight";

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
  uniform float uLimbFacing;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldNormal;
  void main() {
    // The shell is drawn from its back faces, so what is visible is the ring
    // between the planet's limb and the shell's silhouette. "facing" is
    // uLimbFacing at the planet's limb and 0 at the outer edge. The old
    // fresnel term peaked at the OUTER edge — an even glass-bubble halo.
    // Real scattering is densest at the limb and thins outward.
    // clamp: |dot| can exceed 1.0 by float epsilon.
    float facing = clamp(abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0);
    float h = clamp(facing / uLimbFacing, 0.0, 1.0);  // 1 at limb, 0 at edge
    float density = pow(h, 2.2);
    // Sunlit side only, with a soft terminator; the night side keeps a
    // faint airglow rather than a quarter of the day-side glow.
    float sunCos = dot(normalize(vWorldNormal), uSunDir);
    float lit = smoothstep(-0.25, 0.45, sunCos);
    // Warm, sunset-tinted band right at the terminator.
    float du = sunCos / 0.18;  // squared explicitly: pow(neg, 2.0) is undefined in GLSL
    float dusk = exp(-du * du);
    vec3 col = mix(uColor, vec3(1.0, 0.62, 0.38), dusk * 0.55);
    float a = density * (0.04 + 0.96 * lit) * uIntensity * 1.15;
    gl_FragColor = vec4(col, a);
  }
`;

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
}

/** Sun-aware fresnel scattering shell. Place inside a planet group. */
export default function Atmosphere({ radius, color, planetPos, intensity = 1.15, thickness = 1.12, orbitRadius }: AtmosphereProps) {
  const material = useMemo(() => {
    const sunDir = planetPos
      ? new THREE.Vector3(-planetPos.x, -planetPos.y, -planetPos.z).normalize()
      : new THREE.Vector3(0, 1, 0);
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uSunDir: { value: sunDir },
        uIntensity: { value: intensity * (orbitRadius ? irradianceVsAU(orbitRadius) : 1) },
        // facing (|N·V|) of the shell's back face where it passes the
        // planet's limb: sqrt(1 - (r/R)²) for shell radius R = r·thickness.
        uLimbFacing: { value: Math.sqrt(1 - 1 / (thickness * thickness)) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- planetPos is a
    // stable mutated-in-place object; only its identity (not its contents)
    // should retrigger material creation.
  }, [color, intensity, thickness, orbitRadius]);

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
