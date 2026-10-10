import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Procedural galactic sky, painted ONCE into a cube texture at mount and set
 * as the scene background — so it costs nothing per frame, unlike a sky
 * shader running fBm on every pixel every frame.
 *
 * Content: a faint Milky Way-style band along a tilted great circle (warm
 * core toward one side, dark dust lanes through it), a few broad coloured
 * nebula washes in the site palette, and a fine dust of unresolved stars.
 * Deliberately dim: the resolved star layers, nebula sprites and galaxies
 * still sit in front, and the HUD must stay legible over it. Before this the
 * canvas was transparent over a flat #020108 page, so every frame away from
 * a planet was empty black.
 */
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    // Galactic plane: tilted great circle. Latitude 0 on the band.
    vec3 gpole = normalize(vec3(0.32, 0.88, -0.35));
    float lat = dot(d, gpole);
    // Longitude-ish coordinate to place the bright core on one side.
    vec3 gx = normalize(cross(gpole, vec3(0.0, 0.0, 1.0)));
    float lon = dot(d, gx);

    // Warped band profile so the edges are ragged, not a clean stripe.
    float warp = (fbm(d * 3.0) - 0.5) * 0.22;
    // Gaussians squared explicitly: pow() of a negative base is undefined in
    // GLSL and returns NaN on some drivers — baked into the cube, that would
    // blank half the sky and let bloom smear NaN across the frame.
    float bu = (lat + warp) / 0.17;
    float cu = (lat + warp * 0.6) / 0.09;
    float band = exp(-bu * bu);
    float core = exp(-cu * cu) * smoothstep(-0.2, 1.0, lon);

    // Star clouds and dust lanes inside the band.
    float clouds = fbm(d * 7.0 + 3.1);
    float lanes = smoothstep(0.42, 0.68, fbm(d * 11.0 - 7.3));
    float milky = band * (0.35 + 0.65 * clouds) * (1.0 - 0.75 * lanes * band);

    vec3 bandCol = mix(vec3(0.20, 0.24, 0.42), vec3(0.62, 0.52, 0.66), clouds);
    vec3 coreCol = vec3(0.95, 0.72, 0.52);
    vec3 col = bandCol * milky * 0.17 + coreCol * core * (0.6 - 0.45 * lanes) * 0.20;

    // Broad nebula washes in the palette (teal, violet, magenta), very faint.
    float n1 = smoothstep(0.55, 0.85, fbm(d * 1.7 + 11.0));
    float n2 = smoothstep(0.58, 0.88, fbm(d * 1.5 - 4.0));
    float n3 = smoothstep(0.60, 0.90, fbm(d * 2.1 + 23.0));
    col += vec3(0.02, 0.16, 0.18) * n1 * 0.22;
    col += vec3(0.16, 0.04, 0.24) * n2 * 0.22;
    col += vec3(0.20, 0.03, 0.12) * n3 * 0.16;

    // Unresolved star dust: dense in the band, sparse elsewhere.
    float s = hash(floor(d * 600.0));
    float starDust = step(1.0 - (0.0012 + 0.008 * band), s) * (0.3 + 0.7 * hash(floor(d * 600.0) + 1.7));
    col += vec3(0.85, 0.90, 1.0) * starDust * 0.35;

    // Base: deep blue-black, never pure black.
    col += vec3(0.006, 0.006, 0.014);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// 512² is plenty for a sky this soft (the sharp stars are separate point
// layers in front), and it is a one-time render: at 1024² the six faces of
// fBm cost seconds of startup under software rendering.
const FACE_SIZE = 512;

export default function SkyBackdrop() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const skyScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 64, 32);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    skyScene.add(new THREE.Mesh(geo, mat));

    // Half-float keeps the faint gradients smooth, but rendering to it needs
    // an extension some mobile GPUs lack; fall back to 8-bit rather than a
    // black (incomplete) target.
    const halfOk = gl.extensions.has("EXT_color_buffer_half_float") || gl.extensions.has("EXT_color_buffer_float");
    const target = new THREE.WebGLCubeRenderTarget(FACE_SIZE, {
      type: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCam = new THREE.CubeCamera(0.1, 100, target);
    // Render the procedural sky exactly once. Tone mapping is skipped here
    // (the cube holds linear HDR-ish values); the main pass maps it.
    const prevTone = gl.toneMapping;
    gl.toneMapping = THREE.NoToneMapping;
    cubeCam.update(gl, skyScene);
    gl.toneMapping = prevTone;

    const prevBg = scene.background;
    scene.background = target.texture;

    geo.dispose();
    mat.dispose();
    return () => {
      scene.background = prevBg;
      target.dispose();
    };
  }, [gl, scene]);

  return null;
}
