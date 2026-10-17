import * as THREE from "three";
import { exposureCompensation } from "../../utils/sunLight";
import { SUN_SHADOW_CORE_GLSL, sunShadowUniforms } from "./sunShadow";

/**
 * Material for flat navigation guides drawn on a RingGeometry (orbit paths,
 * gravity-field circles): a thin dashed line whose opacity fades with camera
 * distance.
 *
 * The plain MeshBasicMaterial these replaced was a constant-opacity ribbon,
 * fine from afar but — because the camera is always close to *some* part of
 * a 115-185u orbit while visiting a planet — it showed up as wide neon bands
 * slicing across every close-up. Fading near the camera keeps the guide for
 * orientation and removes it exactly where it used to dominate the frame.
 */
export interface GuideLineOptions {
  color: THREE.ColorRepresentation;
  opacity: number;
  /** Dashes around the full circle. 0 = solid. */
  dashes: number;
  /** Fade IN between these camera distances (hidden when closer than [0]). */
  fadeIn: [number, number];
  /** Fade OUT between these camera distances (hidden beyond [1]). Omit for none. */
  fadeOut?: [number, number];
}

const VERT = /* glsl */ `
  varying vec3 vWorld;
  varying float vAngle;
  void main() {
    // RingGeometry lies in its local XY plane; the angle drives the dashes.
    vAngle = atan(position.y, position.x);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDashes;
  uniform vec2 uFadeIn;
  uniform vec2 uFadeOut;
  uniform float uExposureComp; // 1 / exposure where the post pass exposes (sunLight.ts)
  varying vec3 vWorld;
  varying float vAngle;
  void main() {
    float d = distance(cameraPosition, vWorld);
    float fade = smoothstep(uFadeIn.x, uFadeIn.y, d) * (1.0 - smoothstep(uFadeOut.x, uFadeOut.y, d));
    float dash = 1.0;
    if (uDashes > 0.0) {
      float t = fract(vAngle / 6.2831853 * uDashes);
      dash = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.55, 0.63, t));
    }
    float a = uOpacity * fade * dash;
    if (a < 0.003) discard;
    // An instrument projection, not light (F3): the same at every exposure.
    gl_FragColor = vec4(uColor * uExposureComp, a);
  }
`;

export function makeGuideLineMaterial(o: GuideLineOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(o.color) },
      uOpacity: { value: o.opacity },
      uDashes: { value: o.dashes },
      uFadeIn: { value: new THREE.Vector2(...o.fadeIn) },
      uFadeOut: { value: new THREE.Vector2(...(o.fadeOut ?? [1e6, 2e6])) },
      // The shared object (not a copy), so ExposureDriver's one write reaches it.
      uExposureComp: exposureCompensation,
    },
  });
}

/**
 * Planetary ring: many thin translucent bands with gaps (a Cassini-style
 * division and finer ringlets), brighter toward the middle, faint at both
 * edges. Replaces a single flat emissive band that read as a neon hoop.
 *
 * With a shadow slot (F4, docs/UNIVERSE-RULES.md L20) the part of the ring in
 * its planet's shadow darkens: the shared disc-coverage maths of sunShadow.ts
 * against that one occluder slot, from 1 in full sun down to RING_NIGHT_FLOOR
 * in the umbra.
 */
const RING_VERT = /* glsl */ `
  varying float vR;
  varying vec3 vWorld;
  void main() {
    vR = length(position.xy);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RING_FRAG = /* glsl */ `
  #ifdef SUN_SHADOW_RING_SLOT
  ${SUN_SHADOW_CORE_GLSL}
  uniform float uNightFloor;
  varying vec3 vWorld;
  #endif
  uniform vec3 uColor;
  uniform float uInner;
  uniform float uOuter;
  uniform float uOpacity;
  varying float vR;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float bands(float t) {
    // Sum of ringlets at incommensurate frequencies, then a hashed fine grain.
    float b = 0.55 + 0.25 * sin(t * 61.0) + 0.15 * sin(t * 137.0 + 1.3) + 0.1 * sin(t * 290.0 + 2.1);
    float grain = hash(floor(t * 420.0));
    return clamp(b * (0.75 + 0.5 * grain), 0.0, 1.0);
  }
  void main() {
    float t = clamp((vR - uInner) / (uOuter - uInner), 0.0, 1.0);
    float edge = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
    float dv = (t - 0.62) / 0.025;  // squared explicitly: pow(neg, 2.0) is undefined in GLSL
    float division = 1.0 - 0.85 * exp(-dv * dv);
    float a = uOpacity * bands(t) * edge * division;
    vec3 col = mix(uColor, vec3(0.92, 1.0, 0.95), 0.35 * bands(t + 0.3));
    #ifdef SUN_SHADOW_RING_SLOT
    // In the planet's shadow only what the planet's surface keeps from
    // ambient light is left (F4).
    col *= mix( uNightFloor, 1.0, sunShadowVisibility( vWorld, uOccluders[ SUN_SHADOW_RING_SLOT ] ) );
    #endif
    // Lit matter, not an instrument: it follows exposure like its planet (F3).
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * How bright the ring stays in its planet's umbra, as a fraction of full sun:
 * what the planet's own surface keeps there (ambient and emissive light).
 * Measured, not picked, by reading the same pixels of Ruangrapi's surface with
 * its moon's umbra on and off (Apple M5, 2026-10-17): 0.087 in the PostFX
 * tier, whose buffer is linear, and 0.267 in the low-perf tier, which draws
 * tone-mapped sRGB straight to the screen. The ring's shader writes its colour
 * raw in both, so it needs the floor of the space it lands in;
 * SpacePlanets switches it with the tier.
 */
export const RING_NIGHT_FLOOR = { linear: 0.09, display: 0.27 } as const;

/**
 * `shadowSlot`: the planet's eclipse occluder slot (sunShadow.ts). It is a
 * compile-time define, so each slot is its own program, compiled at warm-up.
 */
export function makePlanetRingMaterial(
  color: THREE.ColorRepresentation, inner: number, outer: number, shadowSlot?: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    defines: shadowSlot === undefined ? {} : { SUN_SHADOW_RING_SLOT: shadowSlot },
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uInner: { value: inner },
      uOuter: { value: outer },
      uOpacity: { value: 0.55 },
      // The shared objects, so SpacePlanets' one write per frame reaches the ring.
      uOccluders: sunShadowUniforms.uOccluders,
      uOccluderCount: sunShadowUniforms.uOccluderCount,
      uNightFloor: { value: RING_NIGHT_FLOOR.linear },
    },
  });
}
