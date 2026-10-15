import { useRef, useMemo, useCallback, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSpaceStore, bodies, worldEventElapsed } from "../../store/spaceStore";
import { flareLevel } from "../../utils/worldEvents";
import { planets, SUN_RADIUS } from "../../constants";
import { ambientTime } from "../../utils/ambientTime";
import { GOD_RAYS_SOURCE_FLAGS } from "./godRays";

// Photosphere: boiling granulation cells and limb darkening, in HDR so
// bloom and the god-ray pass keep their punch. Replaces a flat
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
    gl_FragColor = vec4(col * (2.6 + 2.2 * uHeat), 1.0);
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
    gl_FragColor = vec4(col * corona, corona * (1.0 - smoothstep(0.85, 1.0, r)));
  }
`;

interface SunProps {
  onSunReady: (mesh: THREE.Mesh) => void;
}

/** SUN_COLLIDER (data/asteroids.ts) and PostFX's god-ray occlusion track it. */
const CORE_R = SUN_RADIUS;
const CORONA_SIZE = 52;

export default function Sun({ onSunReady }: SunProps) {
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const coronaRef = useRef<THREE.Mesh>(null);

  const surfaceMaterial = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHeat: { value: 1 } },
      vertexShader: surfaceVertex,
      fragmentShader: surfaceFragment,
      // The GodRays pass would set these on mount; set them here so warm-up
      // compiles the variant that is drawn (godRays.ts).
      ...GOD_RAYS_SOURCE_FLAGS,
    }),
    []
  );
  const coronaMaterial = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDisc: { value: (CORE_R * 2) / CORONA_SIZE } },
      vertexShader: coronaVertex,
      fragmentShader: coronaFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    []
  );
  useEffect(() => () => { surfaceMaterial.dispose(); coronaMaterial.dispose(); }, [surfaceMaterial, coronaMaterial]);

  // Callback ref: fires once when the core mesh mounts (feeds the GodRays pass).
  const coreRef = useCallback(
    (mesh: THREE.Mesh | null) => { if (mesh) onSunReady(mesh); },
    [onSunReady]
  );

  useFrame((state) => {
    const t = ambientTime(state.clock.getElapsedTime());
    // Breathing: hotter/cooler over ~7s. Drives brightness, not scale — the
    // GodRays pass samples this mesh's silhouette, so a pulsing silhouette
    // would make the rays throb.
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
      {/* Core (this mesh feeds the GodRays pass) */}
      <mesh ref={coreRef} material={surfaceMaterial}>
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
 * Lens flare: a few soft ghosts and a hex iris along the line from the sun
 * through the screen centre, in camera space so they stay screen-locked.
 * Hidden when the sun is behind the camera or off screen, and when a planet
 * disc covers it (analytic ray-sphere test against the live bodies).
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
function flareTexture(kind: "soft" | "hex" | "ring"): THREE.CanvasTexture {
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
const _dir = new THREE.Vector3();
const _toBody = new THREE.Vector3();
const FLARE_DEPTH = 4; // world units in front of the camera

function SunFlare() {
  const groupRef = useRef<THREE.Group>(null);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const vis = useRef(0);
  const textures = useMemo(() => ({ soft: flareTexture("soft"), hex: flareTexture("hex"), ring: flareTexture("ring") }), []);
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);

  useFrame(({ camera }, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const cam = camera as THREE.PerspectiveCamera;
    _sun.set(0, 0, 0);
    _ndc.copy(_sun).project(cam);
    const inFront = _ndc.z < 1;
    const onScreen = inFront && Math.abs(_ndc.x) < 1.1 && Math.abs(_ndc.y) < 1.1;
    // Occlusion by planets: ray from camera toward the sun vs each body sphere.
    let occluded = false;
    if (onScreen) {
      _dir.subVectors(_sun, cam.position);
      const sunDist = _dir.length();
      _dir.divideScalar(sunDist);
      for (const p of planets) {
        const b = bodies[p.name];
        _toBody.set(b.x - cam.position.x, b.y - cam.position.y, b.z - cam.position.z);
        const along = _toBody.dot(_dir);
        if (along <= 0 || along >= sunDist) continue;
        const perp2 = _toBody.lengthSq() - along * along;
        if (perp2 < p.size * p.size) { occluded = true; break; }
      }
    }
    const target = onScreen && !occluded ? 1 - Math.min(1, Math.hypot(_ndc.x, _ndc.y) / 1.4) * 0.6 : 0;
    vis.current += (target - vis.current) * (1 - Math.pow(0.001, Math.min(delta, 0.05)));
    g.visible = vis.current > 0.01;
    if (!g.visible) return;
    // Place ghosts along the line sun -> centre -> beyond, at FLARE_DEPTH.
    const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * FLARE_DEPTH;
    const halfW = halfH * cam.aspect;
    g.position.copy(cam.position);
    g.quaternion.copy(cam.quaternion);
    FLARE_GHOSTS.forEach((gh, i) => {
      const s = sprites.current[i];
      if (!s) return;
      const nx = _ndc.x * (1 - gh.t * 1.25);
      const ny = _ndc.y * (1 - gh.t * 1.25);
      s.position.set(nx * halfW, ny * halfH, -FLARE_DEPTH);
      const size = gh.size * halfH * 2;
      s.scale.set(size, size, 1);
      (s.material as THREE.SpriteMaterial).opacity = vis.current * 0.3;
    });
  });

  return (
    <group ref={groupRef} visible={false}>
      {FLARE_GHOSTS.map((gh, i) => (
        <sprite key={i} ref={(s) => { sprites.current[i] = s; }} renderOrder={10}>
          <spriteMaterial map={textures[gh.tex]} color={gh.color} transparent depthTest={false} depthWrite={false}
            blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </group>
  );
}
