import * as THREE from "three";

/**
 * Engine plume: an open tube per nozzle that fans out and fades along its
 * length, with a shader that is white-hot at the nozzle, cools to cyan
 * along the length and flickers. Additive, so bloom does the glow.
 *
 * In vacuum there is no ambient pressure to hold the exhaust in, so the
 * plume widens instead of tapering, and shock diamonds do not form: they
 * need an atmosphere to push against (law L31, docs/UNIVERSE-RULES.md).
 *
 * Replaces three 22%-opacity cones that were barely visible, while round
 * particles and a long trail ribbon (which read as a laser line) carried
 * the sense of thrust.
 */
const VERT = /* glsl */ `
  uniform float uSpread;  // extra radius at the tip, as a multiple of the tube radius (0 = a plain tube)
  varying float vAlong;
  varying float vWiden;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // CylinderGeometry uv.y: 1 at the top (nozzle end), 0 at the tip.
    vAlong = 1.0 - uv.y;
    // Widen radially with distance from the nozzle (law L31): the cone's
    // world-space half-angle is set by uSpread, whatever the tube's length.
    vWiden = 1.0 + uSpread * vAlong;
    vec3 p = vec3(position.x * vWiden, position.y, position.z * vWiden);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
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
  varying float vWiden;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float t = vAlong;
    // Brightest along the plume's axis as seen by the camera.
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float core = pow(facing, 1.6);
    float flicker = 0.85 + 0.15 * sin(uTime * 37.0 + uSeed * 3.0) * sin(uTime * 23.0 + uSeed);
    // A widening plume thins out fast: brightest at the nozzle.
    float fall = pow(1.0 - t, 2.4);
    vec3 hot = vec3(0.92, 1.0, 1.0);
    vec3 cool = uColor;
    vec3 col = mix(hot, cool, smoothstep(0.0, 0.45, t));
    // The same exhaust over a wider cross-section is thinner: fade with the widening.
    float thin = 1.0 / pow(vWiden, 0.6);
    float a = core * fall * thin * flicker * (0.25 + 0.55 * min(uPower, 1.6));
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
      uSpread: { value: 0 },
    },
  });
}

/** Half-angle of the exhaust cone, degrees (spec F7: about 25-40). */
export const PLUME_HALF_ANGLE_DEG = 30;

/**
 * The plume material's uSpread for a tube of the given length scale: the tip
 * grows by this multiple of the nozzle radius, so the world-space half-angle
 * is halfAngleDeg whatever the length (the tube is only stretched along Y).
 */
export function plumeSpreadFor(lengthScale: number, nozzleRadius: number, halfAngleDeg: number): number {
  return (lengthScale * Math.tan((halfAngleDeg * Math.PI) / 180)) / nozzleRadius;
}

/** Unit-length open tube along +Y (top = nozzle). The shader fans it out (L31, uSpread). */
export function makePlumeGeometry(nozzleRadius: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(nozzleRadius, nozzleRadius, 1, 20, 12, true);
}

/**
 * The tractor beam's cone, drawn with the plume material: an open tube that
 * is a point at the nose (top, y = 0, the plume shader's bright end) and the
 * full unit radius at y = -1, so scaling it by (r, range, r) matches the catch
 * cone in utils/tractorBeam.ts. The plume tube is a straight tube that the shader
 * fans out from the nozzle; reusing it would put a wide bright mouth around the
 * chase camera, so the beam keeps its own point-to-wide shape (uSpread = 0).
 */
export function makeBeamGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.02, 1, 1, 20, 12, true);
  g.translate(0, -0.5, 0);
  return g;
}

/** The ship's nozzle row in its local frame (Spaceship.tsx). Ghosts use the centre one. */
export const NOZZLE_X = [-0.204, 0, 0.204] as const;
export const NOZZLE_Y = -0.068;
export const NOZZLE_Z = -1.225;
