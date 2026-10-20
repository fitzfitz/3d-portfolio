import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSpaceStore, worldEventElapsed } from "../../store/spaceStore";
import { flareLevel } from "../../utils/worldEvents";
import { SUN_RADIUS } from "../../constants";
import { ambientTime } from "../../utils/ambientTime";
import { sunVisibility } from "../../utils/sunOcclusion";
import { allOccluders } from "./sunShadow";
import { glareLevels } from "../../utils/sunGlare";
import { makeSunSurfaceMaterial, makeSunCoronaMaterial, CORONA_SIZE, SUN_BLOOM_GAIN } from "./sunMaterials";
import { sunApparentRadius, lensScale, coronaLimbFit } from "../../utils/sunLens";

/** SUN_COLLIDER (data/asteroids.ts) and the glare's occlusion test track it. */
const CORE_R = SUN_RADIUS;
/** coronaLimbFit's result, reused every frame. */
const CORONA_FIT = { offset: 0, scale: 1 };

export default function Sun() {
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const coronaRef = useRef<THREE.Mesh>(null);
  const coronaFitRef = useRef<THREE.Group>(null);

  const surfaceMaterial = useMemo(makeSunSurfaceMaterial, []);
  const coronaMaterial = useMemo(() => makeSunCoronaMaterial((CORE_R * 2) / CORONA_SIZE), []);
  useEffect(() => () => { surfaceMaterial.dispose(); coronaMaterial.dispose(); }, [surfaceMaterial, coronaMaterial]);

  useFrame((state) => {
    const t = ambientTime(state.clock.getElapsedTime());
    // Breathing: hotter/cooler over ~7s. Drives brightness, not scale, so the
    // disc's silhouette stays fixed.
    surfaceMaterial.uniforms.uTime.value = t;
    // A world-event flare swells the heat and the corona (spec: slow, two peaks 6s apart).
    const flare = flareLevel(worldEventElapsed("flare"));
    surfaceMaterial.uniforms.uHeat.value = 0.5 + 0.5 * Math.sin(t * 0.9) + 0.6 * flare;
    surfaceMaterial.uniforms.uGain.value = isLowPerf ? 1 : SUN_BLOOM_GAIN;
    coronaMaterial.uniforms.uTime.value = t;
    // The billboard sits on the limb, not through the centre: a flat plane at
    // the centre hid most of the halo behind the 24-unit disc up close. The fit
    // group moves it R²/d toward the camera, faces it down the sun-camera line
    // and scales its disc to the limb (coronaLimbFit); its resting reach from
    // the centre never exceeds CORONA_SIZE / 2 (36 < belt edge 40).
    const fitGroup = coronaFitRef.current;
    if (fitGroup) {
      const cam = state.camera.position;
      const d = cam.length();
      coronaLimbFit(d, CORONA_FIT);
      if (d > 1e-6) fitGroup.position.copy(cam).multiplyScalar(CORONA_FIT.offset / d);
      fitGroup.scale.setScalar(CORONA_FIT.scale);
      fitGroup.lookAt(cam);
    }
    // The swell (1 + 0.6 * flare) briefly pushes the halo to ~r 58, past the belt's
    // inner edge (r 40): an accepted transient; the resting halo stays under 40.
    if (coronaRef.current) coronaRef.current.scale.setScalar(1 + 0.6 * flare);
  });

  return (
    <group position={[0, 0, 0]}>
      <mesh material={surfaceMaterial}>
        <sphereGeometry args={[CORE_R, 64, 64]} />
      </mesh>

      {/* Streamer corona billboard (skipped in low-perf) */}
      {!isLowPerf && (
        <group ref={coronaFitRef}>
          <mesh ref={coronaRef} name="SunCorona" material={coronaMaterial} renderOrder={2}>
            <planeGeometry args={[CORONA_SIZE, CORONA_SIZE]} />
          </mesh>
        </group>
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
    // Occlusion by the bodies and the moons (sunShadow.ts allOccluders, as
    // the ship's shadow reads them): fraction of the sun left uncovered (0..1).
    const visibility = inFront ? sunVisibility(cam.position, allOccluders, SUN_RADIUS) : 0;
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
    // Spikes and veil were sized for a small disc; past that they grow with the
    // disc's apparent size so it never swallows them (sunLens.ts). The veil
    // keeps its total light as it grows (opacity / lens²): at full strength a
    // veil three times wider flooded the whole frame warm brown.
    const lens = lensScale(sunApparentRadius(cam.position.length(), cam.fov));
    if (sp) {
      sp.position.set(_ndc.x * halfW, _ndc.y * halfH, -FLARE_DEPTH);
      sp.scale.set(0.45 * halfH * 2 * lens, 0.45 * halfH * 2 * lens, 1);
      (sp.material as THREE.SpriteMaterial).opacity = glare.spikes * SPIKE_OPACITY_SCALE;
      (sp.material as THREE.SpriteMaterial).color.copy(SPIKE_COLOR).multiplyScalar(comp);
    }
    if (vl) {
      vl.position.set(_ndc.x * halfW, _ndc.y * halfH, -FLARE_DEPTH);
      vl.scale.set(1.2 * halfH * 2 * lens, 1.2 * halfH * 2 * lens, 1);
      (vl.material as THREE.SpriteMaterial).opacity = glare.veil / (lens * lens);
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
    // Named for transition.probe.mjs, which asserts whether the sun is in view
    // where it measures draw calls: this group is the six lens sprites' switch.
    <group ref={groupRef} name="SunGlare" visible={false}>
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
