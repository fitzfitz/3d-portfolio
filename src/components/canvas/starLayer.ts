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

export function makeStarMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uPixelRatio: { value: 1 },
      uOpacity: { value: opacity },
    },
  });
}
