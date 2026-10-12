import { EffectComposer, Bloom, Vignette, ChromaticAberration, GodRays, ToneMapping, SMAA } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { GodRaysEffect } from "postprocessing";
import { useSpaceStore, bodies } from "../../store/spaceStore";
import { planets, SUN_RADIUS } from "../../constants";
import { sunVisibility, type Occluder } from "../../utils/sunOcclusion";

/**
 * Stable offset instance, mutated in place rather than replaced. Passing a
 * fresh array literal per render (as GlobalCanvas used to) changed the prop
 * identity every time anything re-rendered, and rebuilding the composer's
 * children means recompiling every pass -- a hitch mid-flight.
 */
const CA_OFFSET = new THREE.Vector2(0, 0);
// A whisper of lens fringing at warp. At 0.0022/0.0014 it split every bright
// streak into red/green/blue copies and the warp read as glitchy confetti.
const WARP_X = 0.0006;
const WARP_Y = 0.0004;

/**
 * Drives chromatic aberration from the store imperatively. This exists so
 * PostFX never has to subscribe to `isWarping`: a subscription there would
 * re-render the composer on every boost, which is precisely the hitch this
 * refactor removes.
 */
function WarpAberration() {
  useFrame(() => {
    const s = useSpaceStore.getState();
    const on = s.isWarping && !s.reducedMotion;
    CA_OFFSET.set(on ? WARP_X : 0, on ? WARP_Y : 0);
  });
  return null;
}

const GODRAYS_EXPOSURE = 0.18;
/** Reused every frame: planet occluders, positions refreshed from `bodies`. */
const OCCLUDERS: Occluder[] = planets.map((p) => ({ x: 0, y: 0, z: 0, r: p.size }));

/**
 * Fades the god rays by how much of the sun the planets cover. GodRays' own
 * depth test let the sun's disc show through a planet in front of it, so the
 * occlusion is computed here instead (utils/sunOcclusion.ts).
 */
function useGodRaysOcclusion(effect: RefObject<GodRaysEffect | null>) {
  useFrame(({ camera }) => {
    const e = effect.current;
    if (!e) return;
    planets.forEach((p, i) => {
      const b = bodies[p.name];
      OCCLUDERS[i].x = b.x; OCCLUDERS[i].y = b.y; OCCLUDERS[i].z = b.z;
    });
    e.godRaysMaterial.exposure = GODRAYS_EXPOSURE * sunVisibility(camera.position, OCCLUDERS, SUN_RADIUS);
  });
}

interface PostFXProps {
  sunMesh: THREE.Mesh | null;
  /** False in the low-perf tier: the chain stays mounted but stops rendering. */
  enabled: boolean;
}

/**
 * multisampling=0: the GodRays depth passes' buffer formats are incompatible
 * with the MSAA resolve blit (GL_INVALID_OPERATION every frame -> white
 * canvas). Bloom smooths edges anyway, so MSAA here bought nothing.
 */
export default function PostFX({ sunMesh, enabled }: PostFXProps) {
  const gl = useThree((s) => s.gl);
  const godRays = useRef<GodRaysEffect>(null);
  useGodRaysOcclusion(godRays);
  // Low-perf disables the composer instead of unmounting it. Unmounting threw
  // away Bloom's and SMAA's programs, and postprocessing bakes a fresh id into
  // each pass's cache key, so every remount recompiled them from scratch
  // (~10 programs per low-perf round trip, never released). While disabled,
  // R3F's own render runs, so the renderer has to tone-map (same Neutral
  // curve as the ToneMapping pass); while enabled the pass does it, so the
  // renderer must not. This effect runs after EffectComposer's own mount
  // effect (child effects first), so it has the last word.
  useEffect(() => {
    gl.toneMapping = enabled ? THREE.NoToneMapping : THREE.NeutralToneMapping;
  }, [gl, enabled]);
  return (
    <>
      <WarpAberration />
      <EffectComposer multisampling={0} enabled={enabled}>
        <Bloom intensity={1.2} luminanceThreshold={0.2} luminanceSmoothing={0.9} mipmapBlur={true} />
        <Vignette eskil={false} offset={0.28} darkness={0.72} />
        <ChromaticAberration offset={CA_OFFSET} />
        {/* Accumulator budget: HDR sun (emissive 3.2) x weight x decay-series(~10)
            x exposure must stay well under 1.0 or the clamp saturates to a white
            wash. 3.2 x 0.08 x 10 x 0.18 = 0.46 peak. */}
        {sunMesh ? (
          <GodRays ref={godRays} sun={sunMesh} samples={60} density={0.8} decay={0.9}
            weight={0.08} exposure={GODRAYS_EXPOSURE} clampMax={0.8} blur={true} />
        ) : <></>}
        {/* EffectComposer forces the renderer's own tone mapping off while it
            is mounted, so without this pass HDR emissives (sun 7.6, engine
            4.5, plasma 3.6) clipped to flat white — and the image changed
            grade whenever PerformanceMonitor dropped to low-perf, where the
            renderer's mapping applies again. Same curve as the renderer
            (GlobalCanvas onCreated), last so it sees the full HDR result. */}
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        {/* The composer renders into an offscreen target, so the canvas's
            MSAA never touched this tier (and multisampling stays 0, see
            above): planet limbs, rings and the ship edges were fully aliased.
            SMAA runs on the final tone-mapped image, where it is designed to. */}
        <SMAA />
      </EffectComposer>
    </>
  );
}
