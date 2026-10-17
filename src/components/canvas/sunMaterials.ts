import * as THREE from "three";
import { exposureCompensation } from "../../utils/sunLight";

// Photosphere: boiling granulation cells and limb darkening, in HDR so
// bloom keeps its punch. Replaces a flat
// MeshStandardMaterial ball.
const surfaceVertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const NOISE = /* glsl */ `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise3(p); p *= 2.07; a *= 0.5; } return v; }
`;
const surfaceFragment = /* glsl */ `
  uniform float uTime;
  uniform float uHeat;   // 0 cool .. 1 hot (the breathing pulse)
  uniform float uExposureComp; // 1 / exposure where the post pass exposes (sunLight.ts)
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  ${NOISE}
  void main() {
    vec3 p = normalize(vPos);
    // Two scales of convection, slowly churning.
    float cells = fbm3(p * 6.0 + vec3(0.0, uTime * 0.05, uTime * 0.03));
    float fine = fbm3(p * 22.0 - vec3(uTime * 0.11, 0.0, uTime * 0.07));
    float g = smoothstep(0.25, 0.85, cells * 0.7 + fine * 0.45);
    float mu = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
    // Limb darkening: centre white-hot, edge deep orange.
    float limb = pow(mu, 0.45);
    vec3 edge = vec3(1.0, 0.28, 0.04);
    vec3 mid = vec3(1.0, 0.62, 0.22);
    vec3 hot = vec3(1.0, 0.93, 0.78);
    vec3 col = mix(edge, mid, limb);
    col = mix(col, hot, limb * limb * (0.55 + 0.45 * g));
    col *= 0.75 + 0.5 * g;
    gl_FragColor = vec4(col * (2.6 + 2.2 * uHeat) * uExposureComp, 1.0);
  }
`;

// Corona: a camera-facing billboard with radial streamers that churn
// slowly, falling off with distance from the disc. Replaces a uniform rim
// shell plus two round flare sprites.
const coronaVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const coronaFragment = /* glsl */ `
  uniform float uTime;
  uniform float uDisc;     // disc radius as a fraction of the billboard half-size
  uniform float uExposureComp; // 1 / exposure where the post pass exposes (sunLight.ts)
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float a = atan(vUv.y, vUv.x);
    float x = max(r - uDisc, 0.0) / (1.0 - uDisc);   // 0 at the limb, 1 at the edge
    // Streamers: angular noise stretched radially, rotating very slowly.
    vec3 q = vec3(cos(a) * 2.2, sin(a) * 2.2, uTime * 0.06);
    float streak = fbm3(q * 1.6 + vec3(0.0, 0.0, x * 0.8));
    float rays = pow(smoothstep(0.35, 0.95, streak), 1.6);
    float glow = exp(-x * 7.0) * 0.9 + exp(-x * 2.6) * 0.25;
    float corona = glow * (0.45 + 1.4 * rays * exp(-x * 1.4));
    vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.85, 0.6), exp(-x * 4.0));
    gl_FragColor = vec4(col * corona * uExposureComp, corona * (1.0 - smoothstep(0.85, 1.0, r)));
  }
`;

/**
 * The photosphere. Self-luminous (F3): compensated by the shared
 * `exposureCompensation` object (not a copy), so ExposureDriver's one write a
 * frame lands here and the disc looks the same at every exposure.
 */
export function makeSunSurfaceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 1 }, uExposureComp: exposureCompensation },
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    // The corona billboard blends across the disc, so the core draws in the
    // transparent pass without writing depth.
    transparent: true,
    depthWrite: false,
  });
}

/**
 * The corona billboard's edge length. Half of it (36) must stay inside the
 * belt's inner edge (r 40); the core is SUN_RADIUS (24), so the halo is the
 * 12 units between (tests/sunProportions.test.ts).
 */
export const CORONA_SIZE = 72;

/** The corona billboard; `disc` is the disc radius as a fraction of its half-size. Compensated like the core. */
export function makeSunCoronaMaterial(disc: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDisc: { value: disc }, uExposureComp: exposureCompensation },
    vertexShader: coronaVertex,
    fragmentShader: coronaFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
