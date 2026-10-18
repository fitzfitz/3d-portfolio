import * as THREE from "three";
import { irradianceVsAU, litExposure } from "../../utils/sunLight";

/** Shared by the atmosphere shell and the gas-giant limb darkening (Atmosphere.tsx). */
export const ATMOSPHERE_VERT = /* glsl */ `
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

const ATMOSPHERE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSunDir;
  uniform float uIntensity;
  uniform float uLimbFacing;
  uniform float uLitExposure; // the exposure where no post pass applies it (sunLight.ts)
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
    // Scattered sunlight is lit matter: it follows exposure like its planet,
    // in low-perf too. On alpha, not colour: under additive blending that
    // scales the light added and keeps its hue (colour would clip to white).
    gl_FragColor = vec4(col, a * uLitExposure);
  }
`;

export interface AtmosphereMaterialOptions {
  color: THREE.ColorRepresentation;
  /** The planet's world position (the sun is at the origin); see Atmosphere.tsx. */
  planetPos?: { x: number; y: number; z: number };
  /** Overall strength at 1 AU. */
  intensity?: number;
  /** The planet's orbit radius: the rim scales with the sunlight there (L27 under L19). */
  orbitRadius?: number;
  /** Shell thickness multiplier. */
  thickness?: number;
}

/** The sun-aware scattering shell's material (Atmosphere.tsx). */
export function makeAtmosphereMaterial({
  color, planetPos, intensity = 1.15, thickness = 1.12, orbitRadius,
}: AtmosphereMaterialOptions): THREE.ShaderMaterial {
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
      // The shared object, so ExposureDriver's one write reaches every rim.
      uLitExposure: litExposure,
    },
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false,
  });
}
