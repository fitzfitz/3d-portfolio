import * as THREE from "three";

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
    gl_FragColor = vec4(uColor, a);
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
    },
  });
}

/**
 * Planetary ring: many thin translucent bands with gaps (a Cassini-style
 * division and finer ringlets), brighter toward the middle, faint at both
 * edges. Replaces a single flat emissive band that read as a neon hoop.
 */
const RING_VERT = /* glsl */ `
  varying float vR;
  void main() {
    vR = length(position.xy);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const RING_FRAG = /* glsl */ `
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
    gl_FragColor = vec4(col, a);
  }
`;

export function makePlanetRingMaterial(color: THREE.ColorRepresentation, inner: number, outer: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uInner: { value: inner },
      uOuter: { value: outer },
      uOpacity: { value: 0.55 },
    },
  });
}
