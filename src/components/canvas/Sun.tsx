import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSpaceStore, bodies, worldEventElapsed } from "../../store/spaceStore";
import { flareLevel } from "../../utils/worldEvents";
import { planets, SUN_RADIUS } from "../../constants";
import { ambientTime } from "../../utils/ambientTime";
import { sunVisibility, type Occluder } from "../../utils/sunOcclusion";
import { glareLevels } from "../../utils/sunGlare";
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

/** SUN_COLLIDER (data/asteroids.ts) and the glare's occlusion test track it. */
const CORE_R = SUN_RADIUS;
const CORONA_SIZE = 52;

export default function Sun() {
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const coronaRef = useRef<THREE.Mesh>(null);

  const surfaceMaterial = useMemo(
    () => new THREE.ShaderMaterial({
      // Self-luminous (F3): compensated so the disc looks the same at every
      // exposure. The shared uniform object, so ExposureDriver's write lands here.
      uniforms: { uTime: { value: 0 }, uHeat: { value: 1 }, uExposureComp: exposureCompensation },
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment,
      // The corona billboard blends across the disc, so the core draws in the
      // transparent pass without writing depth.
      transparent: true,
      depthWrite: false,
    }),
    []
  );
  const coronaMaterial = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDisc: { value: (CORE_R * 2) / CORONA_SIZE }, uExposureComp: exposureCompensation },
      vertexShader: coronaVertex,
      fragmentShader: coronaFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    []
  );
  useEffect(() => () => { surfaceMaterial.dispose(); coronaMaterial.dispose(); }, [surfaceMaterial, coronaMaterial]);

  useFrame((state) => {
    const t = ambientTime(state.clock.getElapsedTime());
    // Breathing: hotter/cooler over ~7s. Drives brightness, not scale, so the
    // disc's silhouette stays fixed.
    surfaceMaterial.uniforms.uTime.value = t;
    // A world-event flare swells the heat and the corona (spec: slow, two peaks 6s apart).
    const flare = flareLevel(worldEventElapsed("flare"));
    surfaceMaterial.uniforms.uHeat.value = 0.5 + 0.5 * Math.sin(t * 0.9) + 0.6 * flare;
    coronaMaterial.uniforms.uTime.value = t;
    if (coronaRef.current) coronaRef.current.quaternion.copy(state.camera.quaternion);
    if (coronaRef.current) coronaRef.current.scale.setScalar(1 + 0.6 * flare);
  });

  return (
    <group position={[0, 0, 0]}>
      <mesh material={surfaceMaterial}>
        <sphereGeometry args={[CORE_R, 64, 64]} />
      </mesh>

      {/* Streamer corona billboard (skipped in low-perf) */}
      {!isLowPerf && (
        <mesh ref={coronaRef} name="SunCorona" material={coronaMaterial} renderOrder={2}>
          <planeGeometry args={[CORONA_SIZE, CORONA_SIZE]} />
        </mesh>
      )}
      {!isLowPerf && <SunFlare />}
    </group>
  );
}

/**
 * Lens effects (L22): a veiling glare and diffraction spikes at the sun's
 * screen point, plus a few soft ghosts and a hex iris along the line through
 * the screen centre, in camera space so they stay screen-locked. Hidden when
 * the sun is behind the camera, and faded by how much of it the planets cover
 * (sunVisibility, one occlusion model for all of them). No volumetric beams:
 * vacuum has nothing to scatter light into (L21).
 */
// Kept small and faint: ghosts land wherever the sun's mirror line crosses
// the screen, which from a chase camera is usually right over the ship, so
// big saturated rings there read as an overlay rather than a lens.
const FLARE_GHOSTS = [
  { t: 0.3, size: 0.05, color: "#9fe0ff", tex: "soft" as const },
  { t: 0.62, size: 0.03, color: "#ffc38a", tex: "hex" as const },
  { t: 1.0, size: 0.07, color: "#c9a8ff", tex: "ring" as const },
  { t: 1.35, size: 0.035, color: "#8fffe0", tex: "hex" as const },
];
function flareTexture(kind: "soft" | "hex" | "ring" | "spikes"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.translate(64, 64);
    if (kind === "hex") {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.lineTo(Math.cos(a) * 54, Math.sin(a) * 54); }
      ctx.closePath();
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 56);
      g.addColorStop(0, "rgba(255,255,255,0.10)"); g.addColorStop(0.8, "rgba(255,255,255,0.25)"); g.addColorStop(1, "rgba(255,255,255,0.0)");
      ctx.fillStyle = g; ctx.fill();
    } else if (kind === "ring") {
      const g = ctx.createRadialGradient(0, 0, 30, 0, 0, 62);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.7, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(-64, -64, 128, 128);
    } else if (kind === "spikes") {
      // Six thin rays (three lines through the centre) fading outward.
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate((i / 3) * Math.PI + Math.PI / 6);
        const g = ctx.createLinearGradient(-62, 0, 62, 0);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,0.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.fillRect(-62, -1.2, 124, 2.4);
        ctx.restore();
      }
      const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 14);
      core.addColorStop(0, "rgba(255,255,255,0.6)"); core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = core; ctx.fillRect(-64, -64, 128, 128);
    } else {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 62);
      g.addColorStop(0, "rgba(255,255,255,0.45)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(-64, -64, 128, 128);
    }
  }
  return new THREE.CanvasTexture(c);
}

const _sun = new THREE.Vector3();
const _ndc = new THREE.Vector3();
/** Reused every frame: planet occluders, positions refreshed from `bodies`. */
const OCCLUDERS: Occluder[] = planets.map((p) => ({ x: 0, y: 0, z: 0, r: p.size }));
const FLARE_DEPTH = 4; // world units in front of the camera
/** The spikes are faint (spec F5): glareLevels peaks at 1.5 with a flare, so scale that to ~0.55. */
const SPIKE_OPACITY_SCALE = 0.55 / 1.5;
const GLARE_OUT = { spikes: 0, veil: 0 };
/**
 * The sprites' own colours. Each frame their material colour is this times
 * 1 / exposure (F3): a SpriteMaterial is tone-mapped, so it is exposed in both
 * tiers (by the ToneMapping pass, or by the renderer in low-perf), and the
 * glare must look the same at every exposure, like the disc.
 */
const SPIKE_COLOR = new THREE.Color("#fff4e0");
const VEIL_COLOR = new THREE.Color("#ffd9a0");
const GHOST_COLORS = FLARE_GHOSTS.map((gh) => new THREE.Color(gh.color));

function SunFlare() {
  const groupRef = useRef<THREE.Group>(null);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const spikesRef = useRef<THREE.Sprite>(null);
  const veilRef = useRef<THREE.Sprite>(null);
  const vis = useRef(0);
  const textures = useMemo(() => ({ soft: flareTexture("soft"), hex: flareTexture("hex"), ring: flareTexture("ring"), spikes: flareTexture("spikes") }), []);
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);

  useFrame(({ camera, gl }, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const comp = 1 / gl.toneMappingExposure;
    const cam = camera as THREE.PerspectiveCamera;
    _sun.set(0, 0, 0);
    _ndc.copy(_sun).project(cam);
    const inFront = _ndc.z < 1;
    const onScreen = inFront && Math.abs(_ndc.x) < 1.1 && Math.abs(_ndc.y) < 1.1;
    // Occlusion by planets: fraction of the sun left uncovered (0..1).
    for (let i = 0; i < planets.length; i++) {
      const b = bodies[planets[i].name];
      OCCLUDERS[i].x = b.x; OCCLUDERS[i].y = b.y; OCCLUDERS[i].z = b.z;
    }
    const visibility = inFront ? sunVisibility(cam.position, OCCLUDERS, SUN_RADIUS) : 0;
    const flare = flareLevel(worldEventElapsed("flare"));
    const glare = glareLevels(_ndc.x, _ndc.y, inFront, visibility, flare, GLARE_OUT);
    const target = onScreen ? visibility * (1 - Math.min(1, Math.hypot(_ndc.x, _ndc.y) / 1.4) * 0.6) : 0;
    vis.current += (target - vis.current) * (1 - Math.pow(0.001, Math.min(delta, 0.05)));
    g.visible = vis.current > 0.01 || glare.spikes > 0.005;
    if (!g.visible) return;
    // Place ghosts along the line sun -> centre -> beyond, at FLARE_DEPTH.
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * FLARE_DEPTH;
    const halfW = halfH * cam.aspect;
    g.position.copy(cam.position);
    g.quaternion.copy(cam.quaternion);
    const sp = spikesRef.current, vl = veilRef.current;
    if (sp) {
      sp.position.set(_ndc.x * halfW, _ndc.y * halfH, -FLARE_DEPTH);
      sp.scale.set(0.45 * halfH * 2, 0.45 * halfH * 2, 1);
      (sp.material as THREE.SpriteMaterial).opacity = glare.spikes * SPIKE_OPACITY_SCALE;
      (sp.material as THREE.SpriteMaterial).color.copy(SPIKE_COLOR).multiplyScalar(comp);
    }
    if (vl) {
      vl.position.set(_ndc.x * halfW, _ndc.y * halfH, -FLARE_DEPTH);
      vl.scale.set(1.2 * halfH * 2, 1.2 * halfH * 2, 1);
      (vl.material as THREE.SpriteMaterial).opacity = glare.veil;
      (vl.material as THREE.SpriteMaterial).color.copy(VEIL_COLOR).multiplyScalar(comp);
    }
    for (let i = 0; i < FLARE_GHOSTS.length; i++) {
      const gh = FLARE_GHOSTS[i];
      const s = sprites.current[i];
      if (!s) continue;
      const nx = _ndc.x * (1 - gh.t * 1.25);
      const ny = _ndc.y * (1 - gh.t * 1.25);
      s.position.set(nx * halfW, ny * halfH, -FLARE_DEPTH);
      const size = gh.size * halfH * 2;
      s.scale.set(size, size, 1);
      (s.material as THREE.SpriteMaterial).opacity = vis.current * 0.3;
      (s.material as THREE.SpriteMaterial).color.copy(GHOST_COLORS[i]).multiplyScalar(comp);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <sprite ref={spikesRef} renderOrder={10}>
        <spriteMaterial map={textures.spikes} color="#fff4e0" transparent depthTest={false} depthWrite={false}
          blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={veilRef} renderOrder={10}>
        <spriteMaterial map={textures.soft} color="#ffd9a0" transparent depthTest={false} depthWrite={false}
          blending={THREE.AdditiveBlending} />
      </sprite>
      {FLARE_GHOSTS.map((gh, i) => (
        <sprite key={i} ref={(s) => { sprites.current[i] = s; }} renderOrder={10}>
          <spriteMaterial map={textures[gh.tex]} color={gh.color} transparent depthTest={false} depthWrite={false}
            blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </group>
  );
}
