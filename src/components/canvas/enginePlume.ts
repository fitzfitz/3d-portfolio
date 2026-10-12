import * as THREE from "three";

/**
 * Engine plume: an open, tapered tube per nozzle with a shader that is
 * white-hot at the nozzle, cools to cyan along the length, shows a few
 * travelling shock diamonds and flickers. Additive, so bloom does the glow.
 *
 * Replaces three 22%-opacity cones that were barely visible, while round
 * particles and a long trail ribbon (which read as a laser line) carried
 * the sense of thrust.
 */
const VERT = /* glsl */ `
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // CylinderGeometry uv.y: 1 at the top (nozzle end), 0 at the tip.
    vAlong = 1.0 - uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPower;   // 0 idle .. 1 cruise .. ~2 warp
  uniform float uSeed;
  uniform vec3 uColor;   // the plume's cool end (engine cyan by default)
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float t = vAlong;
    // Brightest along the plume's axis as seen by the camera.
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float core = pow(facing, 1.6);
    // Shock diamonds that drift slightly with time.
    float diamonds = 0.65 + 0.35 * sin(t * 26.0 - uTime * 9.0 + uSeed);
    float flicker = 0.85 + 0.15 * sin(uTime * 37.0 + uSeed * 3.0) * sin(uTime * 23.0 + uSeed);
    float fall = pow(1.0 - t, 1.7);
    vec3 hot = vec3(0.92, 1.0, 1.0);
    vec3 cool = uColor;
    vec3 col = mix(hot, cool, smoothstep(0.0, 0.45, t));
    float a = core * fall * mix(1.0, diamonds, smoothstep(0.05, 0.3, t)) * flicker
            * (0.25 + 0.55 * min(uPower, 1.6));
    gl_FragColor = vec4(col * (1.0 + 0.6 * uPower), a);
  }
`;

/** Default "cool" end of the plume: the engine's cyan (0, 0.85, 1). */
const ENGINE_COOL = new THREE.Color(0, 0.85, 1);

export function makePlumeMaterial(seed: number, color: THREE.Color = ENGINE_COOL): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0.3 },
      uSeed: { value: seed },
      uColor: { value: color.clone() },
    },
  });
}

/** Unit-length open tube along +Y (top = nozzle), tapering to the tip. */
export function makePlumeGeometry(nozzleRadius: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(nozzleRadius, nozzleRadius * 0.18, 1, 20, 12, true);
}
