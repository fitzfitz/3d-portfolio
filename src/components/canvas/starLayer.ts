import * as THREE from "three";

/**
 * Round, soft-edged stars with per-star brightness. Sizes are in screen pixels,
 * unattenuated: the shells are a sky at infinity riding with the ship, not
 * objects at a distance. There is deliberately no time input: stars do not
 * twinkle in vacuum (L23) and show no motion at these distances (L24).
 */
const STAR_VERT = /* glsl */ `
  attribute float aSize;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = color;
    gl_PointSize = max(1.0, aSize * uPixelRatio);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const STAR_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    // Bright core plus a soft halo; zero at the sprite edge so no square rim.
    float a = 1.0 - smoothstep(0.0, 0.5, d);  // edge0 < edge1: reversed edges are undefined in GLSL
    a = a * a;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a * uOpacity, 1.0);
  }
`;

/**
 * The shells are the sky at infinity, but they sit 40-260 from the ship, so a
 * depth-tested shell would draw over any world farther than that. Instead
 * they are background: opaque-list (not transparent) with a negative render
 * order, so they draw first, before every opaque body, and with no depth test
 * or write, so every world drawn after them covers them. Additive blending
 * still applies (three keeps a non-Normal blending on an opaque material).
 * Set on the Points object (GlobalCanvas's StarLayer).
 */
export const STAR_RENDER_ORDER = -1;

export function makeStarMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    vertexColors: true,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPixelRatio: { value: 1 },
      uOpacity: { value: opacity },
    },
  });
}

/**
 * A distant galaxy's sprite material (DistantGalaxies). The galaxies ride
 * with the ship at ~200-290 u like the star shells, so they are background
 * the same way: opaque-list, drawn first (STAR_RENDER_ORDER on the sprite),
 * with no depth test or write. A non-Normal blending keeps the map's alpha
 * (three defines OPAQUE only for Normal blending), so the sprite still fades.
 */
export function makeGalaxyMaterial(map: THREE.Texture | null): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map,
    transparent: false,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
}
