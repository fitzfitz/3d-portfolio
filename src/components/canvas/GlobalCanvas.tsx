// First: the hue-keeping toe must be in the tone-mapping chunk before any program compiles.
import "./hueToe";
import { Canvas, useFrame, useThree, invalidate } from "@react-three/fiber";
import { Html, PerformanceMonitor, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, use, useRef, useMemo, useState, useEffect, useLayoutEffect, memo, type ReactNode } from "react";
import * as THREE from "three";
import { makeStarMaterial, STAR_RENDER_ORDER } from "./starLayer";
import { softSprite } from "./softSprite";
import Spaceship from "./Spaceship";
import TractorBeam from "./TractorBeam";
import ProjectProbes from "./ProjectProbes";
import SpacePlanets from "./SpacePlanets";
import SolarBodies from "./SolarBodies";
import SolarMoons from "./SolarMoons";
import BodyDots from "./BodyDots";
import Sun from "./Sun";
import { PlasmaAnomalies } from "./PlasmaAnomalies";
import type { AnomaliesRef } from "./PlasmaAnomalies";
import PostFX from "./PostFX";
import SpaceEnvironment from "./SpaceEnvironment";
import { CAMERA_FAR, LOG_DEPTH_BUFFER } from "./logDepth";
import SafeErrorBoundary from "./SafeErrorBoundary";
import Asteroids from "./Asteroids";
import AsteroidBelt from "./AsteroidBelt";
import CargoTraffic from "./CargoTraffic";
import ShootingStars from "./ShootingStars";
import DistantGalaxies from "./DistantGalaxies";
import WarpTunnel from "./WarpTunnel";
import SpaceJellyfish from "./SpaceJellyfish";
import WorldEventDirector from "./WorldEventDirector";
import Comets from "./Comets";
import DataShards from "./DataShards";
import CareerStation from "./CareerStation";
import CareerTrail from "./CareerTrail";
import Shipyard from "./Shipyard";
import DormantGate from "./DormantGate";
import RaceCourse from "./RaceCourse";
import Bottles from "./Bottles";
import Ghosts from "./Ghosts";
import { liveSkyUrl } from "../../utils/liveSky";
import { beaconApiUrl } from "../../utils/beaconApi";
import Scanner from "./Scanner";
import WaypointDriver from "./WaypointDriver";
import SkyBackdrop from "./SkyBackdrop";
import { flight, useSpaceStore, selectSceneFrozen, worldEventElapsed } from "../../store/spaceStore";
import { flareLevel } from "../../utils/worldEvents";
import {
  SUN_COLOR, SUN_LIGHT_INTENSITY, SUN_FLARE_SWELL, targetExposure, stepExposure, setExposureCompensation,
  AMBIENT_BASE, applyFill, applyBackdrop, fillLight,
} from "../../utils/sunLight";
import DebugBridge from "../../debug/DebugBridge";
import PerfSampler from "../../debug/PerfSampler";
import { fitzDebug } from "../../debug/bridge";
import { SPAWN } from "../../data/spawn";
import { HAS_ASSET_PACK, loadAssetPack, onPackEntry, packProgress } from "../../utils/assetPack";
import { sceneTextures, releaseUploadedImages, clearSceneAssets, retireKtx2Workers } from "../../utils/sceneAssets";
import { budgetDpr } from "../../utils/pixelBudget";

// Parse each model the moment the asset pack delivers it (utils/assetPack.ts),
// while the rest still streams, so the scene's own useGLTF finds it cached.
// Keyed by the same blob: URL assetUrl() returns. Textures are not preloaded:
// useTexture caches by the whole URL list a component asks for.
onPackEntry((path, url) => {
  if (path.endsWith(".glb")) useGLTF.preload(url);
});

interface StarLayerProps {
  count: number;
  radiusMin: number;
  radiusMax: number;
  /** Largest star diameter in CSS pixels; most stars are far smaller. */
  maxPx: number;
  opacity: number;
}

function StarLayer({ count, radiusMin, radiusMax, maxPx, opacity }: StarLayerProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const [positions, colors, sizes] = useMemo(() => {
    const posArr = new Float32Array(count * 3);
    const colArr = new Float32Array(count * 3);
    const sizeArr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Uniform on the sphere: y = cos(polar) uniform in [-1, 1)
      const u = Math.random() * 2 - 1;
      const az = Math.random() * Math.PI * 2;
      const sr = Math.sqrt(1 - u * u);
      const radius = radiusMin + Math.random() * (radiusMax - radiusMin);
      posArr[i * 3] = sr * Math.cos(az) * radius;
      posArr[i * 3 + 1] = u * radius;
      posArr[i * 3 + 2] = sr * Math.sin(az) * radius;
      // Magnitude skewed hard toward faint, as in a real sky: a few bright
      // stars carry the field, the rest are texture. Brightness rides in the
      // colour (additive blend), size in aSize.
      const m = Math.pow(Math.random(), 3);
      const bright = 0.35 + 0.65 * m;
      const rand = Math.random();
      const tint = rand < 0.75 ? [1, 1, 1] : rand < 0.9 ? [0.72, 0.88, 1.0] : [1.0, 0.78, 0.58];
      colArr.set([tint[0] * bright, tint[1] * bright, tint[2] * bright], i * 3);
      sizeArr[i] = maxPx * (0.35 + 0.65 * m);
    }
    return [posArr, colArr, sizeArr];
  }, [count, radiusMin, radiusMax, maxPx]);

  const material = useMemo(() => makeStarMaterial(opacity), [opacity]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((state) => {
    if (!pointsRef.current) return;
    // The shells are the infinite sky: they translate with the ship (no positional
    // parallax — the DustField supplies that) and never rotate or flicker.
    pointsRef.current.position.set(flight.x, flight.y, flight.z);
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();
  });

  return (
    <points ref={pointsRef} name="StarLayer" material={material} renderOrder={STAR_RENDER_ORDER}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} count={count} array={colors} itemSize={3} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} count={count} array={sizes} itemSize={1} />
      </bufferGeometry>
    </points>
  );
}

// Dense enough that specks stream past within a few ship-lengths: the main
// speed cue at cruise. Unmounted in low-perf mode, so no fallback count.
const DUST_COUNT = 1800;
const DUST_CUBE = 90;
const DUST_HALF = DUST_CUBE / 2;

/**
 * Near-field "dust" stars: world-anchored points wrapped modulo a cube that
 * rides with the ship — free parallax speed cues on every axis (spec §4).
 */
function DustField() {
  const pointsRef = useRef<THREE.Points>(null);
  const seeds = useMemo(() => {
    const a = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < a.length; i++) a[i] = Math.random() * DUST_CUBE;
    return a;
  }, []);
  const positions = useMemo(() => new Float32Array(DUST_COUNT * 3), []);

  useFrame(() => {
    if (!pointsRef.current) return;
    pointsRef.current.position.set(flight.x, flight.y, flight.z);
    const ship = [flight.x, flight.y, flight.z];
    const attr = pointsRef.current.geometry.attributes.position;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      let d = (seeds[i] - ship[i % 3]) % DUST_CUBE;
      if (d < -DUST_HALF) d += DUST_CUBE;
      else if (d >= DUST_HALF) d -= DUST_CUBE;
      arr[i] = d;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]}
          count={DUST_COUNT} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color="#9fb4d8" size={0.13} map={softSprite} transparent={true} opacity={0.6}
        blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

// Three depths of fixed stars that ride with the ship: no parallax, they never
// move (L24) and never twinkle in vacuum (L23).
function GalaxyStarfield({ isLowPerf }: { isLowPerf: boolean }) {
  return (
    <>
      <StarLayer count={1300} radiusMin={140} radiusMax={260} maxPx={2.2} opacity={0.8} />
      <StarLayer count={800} radiusMin={80} radiusMax={180} maxPx={2.8} opacity={0.9} />
      <StarLayer count={400} radiusMin={40} radiusMax={120} maxPx={3.6} opacity={1.0} />
      {!isLowPerf && <DustField />}
    </>
  );
}

// Module-scope, not effect-scoped: THREE.DefaultLoadingManager's own
// loaded/total counters are cumulative for the whole page session and never
// reset between Suspense fallbacks. An effect-scoped local resets to 0 on
// every remount (Suspense can fall back more than once), while the manager's
// counters keep climbing -- so a second batch's very first progress event
// would already read close to 100%, not the fresh 0% the comment on `update`
// below promises. Living at module scope makes that promise actually hold:
// it persists across remounts and is advanced only when a batch fully
// completes (loaded === total), so each new batch is measured from where the
// previous one left off, not from an artificial zero.
let lastTotalLoaded = 0;

// Rendered as the Suspense fallback, so it mounts inside the Canvas tree.
// 3.6MB across eleven GLBs and three textures is a real wait on a slow
// connection; report it honestly instead of an indefinite pulse.
//
// Deliberately NOT drei's useProgress: that hook is backed by a zustand store
// that THREE.DefaultLoadingManager writes into synchronously from whichever
// component's render happens to trigger a loader callback -- e.g. a sibling
// useGLTF suspending mid-render -- which manifests as "Cannot update a
// component (LoadProgress) while rendering a different component
// (OrbitingMoon)". That's a real cross-component setState-during-render, not
// e2e noise, so it's driven imperatively instead, the same way PerfOverlay
// drives its readout: the manager's own callbacks write into a ref, and a
// rAF loop reads the ref and pokes the DOM directly. No React state ever
// sits on the update path, so there's nothing to update mid-render.
function LoadProgress() {
  const barRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ progress: 0, item: "" });

  useEffect(() => {
    const manager = THREE.DefaultLoadingManager;
    // Nothing else in this codebase touches DefaultLoadingManager today, but
    // it's a process-wide singleton, not something this component owns --
    // save whatever was already wired up and chain to it rather than
    // clobbering it, and restore it on unmount so a remount (Suspense can
    // fall back more than once) doesn't stack handlers. onError is not
    // included here: this component doesn't display an error state, so
    // reassigning it would only be a pass-through to whatever was already
    // there -- dead indirection with nothing to add.
    const prevOnStart = manager.onStart;
    const prevOnProgress = manager.onProgress;
    const prevOnLoad = manager.onLoad;

    // Mirrors drei's useProgress math so the readout behaves the same:
    // percentage is relative to the total *since the last fully-completed
    // batch*, not since page load, so a second Suspense fallback later in
    // the session (e.g. a lazily-loaded model) still reads 0% -> 100%
    // instead of picking up from wherever the first batch left off.
    const update = (loaded: number, total: number, item: string, fallback: number) => {
      const pct = (loaded - lastTotalLoaded) / (total - lastTotalLoaded) * 100 || fallback;
      stateRef.current = { progress: pct, item };
    };

    manager.onStart = (item, loaded, total) => {
      update(loaded, total, item, 0);
      prevOnStart?.(item, loaded, total);
    };
    manager.onProgress = (item, loaded, total) => {
      if (loaded === total) lastTotalLoaded = total;
      update(loaded, total, item, 100);
      prevOnProgress?.(item, loaded, total);
    };
    manager.onLoad = () => {
      stateRef.current = { progress: 100, item: "" };
      prevOnLoad?.();
    };

    let raf = 0;
    const tick = () => {
      // While the asset packs stream, they are the whole wait: show their
      // bytes. The loading manager only sees the instant blob: loads after.
      if (HAS_ASSET_PACK && !packProgress.done) {
        const { loaded, total } = packProgress;
        const mb = (n: number) => (n / 1048576).toFixed(1);
        if (barRef.current) barRef.current.style.width = `${total ? ((loaded / total) * 100).toFixed(0) : 0}%`;
        if (labelRef.current) labelRef.current.textContent = `${mb(loaded)} / ${mb(total)} MB`;
        raf = requestAnimationFrame(tick);
        return;
      }
      const { progress, item } = stateRef.current;
      if (barRef.current) barRef.current.style.width = `${progress.toFixed(0)}%`;
      if (labelRef.current) {
        labelRef.current.textContent = `${progress.toFixed(0)}% ${item ? `— ${item.split("/").pop()}` : ""}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      manager.onStart = prevOnStart;
      manager.onProgress = prevOnProgress;
      manager.onLoad = prevOnLoad;
    };
  }, []);

  return (
    <Html center className="select-none pointer-events-none whitespace-nowrap text-center">
      <div className="font-mono text-xs tracking-widest uppercase text-primary mb-2">
        Initializing Star System
      </div>
      <div className="w-48 h-[2px] bg-primary/20 mx-auto overflow-hidden rounded-full">
        <div ref={barRef} className="h-full bg-primary transition-[width] duration-200" style={{ width: "0%" }} />
      </div>
      <div ref={labelRef} className="font-mono text-[9px] text-primary/50 mt-2" />
    </Html>
  );
}

/**
 * Holds the scene until the asset packs settle (utils/assetPack.ts), so every
 * assetUrl() inside answers from the packs, never with a loose /models URL.
 * Everything outside it (the Canvas, its WebGL context, PostFX) mounts at
 * once and gets ready while the packs download. loadAssetPack() is one
 * cached promise that never rejects, which use() requires.
 */
/**
 * Keeps the canvas inside its pixel budget (utils/pixelBudget.ts) as the
 * window resizes or moves to a screen with another pixel ratio. Replaces
 * drei's AdaptiveDpr, which only ever acted on performance.regress(), which
 * nothing here calls.
 */
function PixelBudget() {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const setDpr = useThree((s) => s.setDpr);
  const [deviceDpr, setDeviceDpr] = useState(() => window.devicePixelRatio);
  useEffect(() => {
    const query = window.matchMedia?.(`(resolution: ${deviceDpr}dppx)`);
    const onChange = () => setDeviceDpr(window.devicePixelRatio);
    query?.addEventListener("change", onChange);
    return () => query?.removeEventListener("change", onChange);
  }, [deviceDpr]);
  useEffect(() => { setDpr(budgetDpr(width, height, deviceDpr)); }, [width, height, deviceDpr, setDpr]);
  return null;
}

function PackGate({ children }: { children: ReactNode }) {
  use(loadAssetPack());
  return children;
}

function FollowingClickPlane({ onSpawn }: { onSpawn: (p: THREE.Vector3) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    ref.current.position.set(flight.x, flight.y, flight.z);
    ref.current.quaternion.copy(camera.quaternion); // face the camera at any pitch
  });
  return (
    <mesh ref={ref}
      onPointerDown={(e) => {
        e.stopPropagation();
        // The event source is #root, so presses on HUD buttons, form fields
        // and the touch joystick reach this raycast too. Only a press that
        // landed on the canvas itself is a click into the void.
        if (!(e.nativeEvent.target instanceof HTMLCanvasElement)) return;
        if (e.point) onSpawn(e.point.clone());
      }}>
      <planeGeometry args={[180, 180]} />
      <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * Warms every shader and texture before the first real frame, then marks the
 * scene ready (which gates the spawn banner). Mounts when the Suspense
 * boundary resolves, i.e. once every GLB and texture is in.
 *
 * Replaces drei's <Preload all>, which called the synchronous gl.compile and
 * then rendered the whole scene six more times through a CubeCamera to force
 * texture uploads: a single ~560ms main-thread freeze on a real GPU, right as
 * the loader handed over. compileAsync issues the same programs but, with
 * KHR_parallel_shader_compile, lets the driver link them off the main thread
 * and polls readiness without blocking. The frame loop is held meanwhile, so
 * no frame stalls on a half-linked program; textures are then uploaded
 * directly. Without the extension (e.g. SwiftShader) compile() is as
 * synchronous as before, so nothing regresses there.
 *
 * Like Preload, it briefly makes invisible objects visible so their
 * materials compile too. Runs in a layout effect so the loop is held before
 * the first post-commit frame.
 */
/** Upper bound on holding the frame loop for compileAsync (see below). */
const WARMUP_TIMEOUT_MS = 8000;

function ShaderWarmup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const setFrameloop = useThree((s) => s.setFrameloop);
  useLayoutEffect(() => {
    let cancelled = false;
    const store = useSpaceStore.getState();
    setFrameloop("never");
    store.setWarmingUp(true);

    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    // three.js picks each program's colour-space and tone-mapping variant from
    // the bound render target. With PostFX on, the scene draws into the
    // composer's buffer (linear, no tone mapping), not the screen, so compile
    // for an off-screen target: otherwise anything hidden at load (the race
    // ghost, live-sky ghosts) compiles a second variant the first time it is
    // drawn. Low-perf mode has no composer and draws to the screen.
    const postFx = !(store.pendingLowPerf ?? store.isLowPerf);
    const target = postFx ? new THREE.WebGLRenderTarget(1, 1) : null;
    const previous = gl.getRenderTarget();
    if (target) gl.setRenderTarget(target);
    // compile() inside compileAsync runs synchronously, so visibility and the
    // render target can be restored as soon as the call returns.
    const ready = gl.compileAsync(scene, camera);
    if (target) { gl.setRenderTarget(previous); target.dispose(); }
    for (const o of hidden) o.visible = false;

    // compileAsync polls program readiness forever: a context lost mid-load,
    // or a throw inside its setTimeout poll, would leave it unsettled and the
    // loop frozen for good. Cap the wait; past it, programs still compiling
    // simply finish on first use, as they did under Preload.
    const settled = Promise.race([
      ready,
      new Promise<void>((resolve) => setTimeout(resolve, WARMUP_TIMEOUT_MS)),
    ]).catch(() => {});
    settled.then(() => {
      if (cancelled) return;
      // Upload textures one per task rather than in one loop: a single
      // 2048² map is tens of ms, and all of them back to back was a ~300ms
      // freeze of its own. Spread out, the page stays responsive throughout.
      // Uniform maps too (the bodies' shaders), so none waits for first sight.
      const textures = sceneTextures(scene);
      const queue = [...textures];
      const step = () => {
        if (cancelled) return;
        const t = queue.pop();
        if (t) { gl.initTexture(t); setTimeout(step, 0); return; }
        // Everything is on the GPU: let the CPU copies and the KTX2
        // transcoder workers go (sceneAssets.ts).
        releaseUploadedImages(gl, textures);
        retireKtx2Workers();
        const s = useSpaceStore.getState();
        s.setWarmingUp(false); // GlobalCanvas resumes the loop and invalidates
        s.setSceneReady(true);
      };
      step();
    });
    // Reset on unmount: the classic-résumé round trip remounts the canvas, and
    // the banner must wait for that load too.
    return () => {
      cancelled = true;
      const s = useSpaceStore.getState();
      s.setWarmingUp(false);
      s.setSceneReady(false);
    };
  }, [gl, scene, camera, setFrameloop]);
  return null;
}

const BEACONS_ENABLED = !!beaconApiUrl();
/**
 * Show bottles off (spec "The visitor setting") draws nothing; its own
 * component so the toggle re-renders only this. Its own Suspense: turned on
 * after load, the model's first fetch must not suspend the whole scene.
 */
function BottlesGate() {
  return useSpaceStore((s) => s.showBottles) ? <Suspense fallback={null}><Bottles /></Suspense> : null;
}
const LIVE_SKY_ENABLED = !!liveSkyUrl();

/**
 * The scene's one sun light, falling off with distance squared (L19): 2.1 at
 * 1 AU (sunLight.ts). A world-event flare swells it by the same fraction as
 * before, 2.1 → 3.2 at 1 AU (no new light). Decay is a uniform, so changing it
 * compiled nothing new.
 */
function SunLight() {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.intensity = SUN_LIGHT_INTENSITY * (1 + SUN_FLARE_SWELL * flareLevel(worldEventElapsed("flare")));
    }
  });
  return <pointLight ref={ref} position={[0, 0, 0]} intensity={SUN_LIGHT_INTENSITY} decay={2} color={SUN_COLOR} />;
}

/**
 * The camera's exposure (F3): eases toward targetExposure(distance from the
 * sun) with a 1.5 s half-life, snapping under reduced motion and on the first
 * frame (so the load does not fade in). It drives `gl.toneMappingExposure`,
 * which both tiers read: the composer's ToneMapping pass in the full tier,
 * the renderer's own tone mapping of built-in materials in low-perf. Then it
 * sets the sun's and the overlays' compensation (sunLight.ts) for the tier
 * actually rendering, and the fill (ambient light and IBL), which falls off
 * like the sunlight with no easing, and the unlit backdrop's single tone-down
 * factor (applyBackdrop). Mounted in both tiers; allocates nothing per frame.
 */
function ExposureDriver() {
  const gl = useThree((s) => s.gl);
  const first = useRef(true);
  useFrame(({ camera, scene }, delta) => {
    const s = useSpaceStore.getState();
    const d = camera.position.length();
    applyFill(scene, d);
    applyBackdrop(scene, d);
    const target = targetExposure(d);
    const e = stepExposure(gl.toneMappingExposure, target, delta, s.reducedMotion || first.current);
    first.current = false;
    gl.toneMappingExposure = e;
    setExposureCompensation(e, !s.isLowPerf);
  });
  return null;
}

/** Hands GlobalCanvas's ambient light to the fill law (sunLight.ts); null on unmount. */
function registerFillAmbient(light: THREE.AmbientLight | null) {
  fillLight.ambient = light;
}

function GlobalCanvas() {
  if (import.meta.env.DEV) fitzDebug.canvasRenderCount++;
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const photoMode = useSpaceStore((s) => s.photoMode);
  const sceneReady = useSpaceStore((s) => s.sceneReady);
  // A dossier freezes the loop; so does the shader warm-up (ShaderWarmup).
  const sceneFrozen = useSpaceStore((s) => selectSceneFrozen(s) || s.warmingUp);
  const anomaliesRef = useRef<AnomaliesRef>(null);
  // frameloop="never" means R3F stops driving rAF entirely; the first frame
  // after unfreezing has to be requested explicitly or the canvas holds the
  // stale frame until something else invalidates it.
  //
  // This relies on invalidate() seeing state.frameloop already flipped back
  // to "always" by the time it runs: R3F's CanvasImpl syncs the `frameloop`
  // prop to its internal store in a useLayoutEffect (react-three-fiber.esm.js),
  // and React always flushes layout effects before passive ones, so that sync
  // is guaranteed to land before this useEffect fires. invalidate() no-ops
  // silently while frameloop is still "never" (no error, just nothing
  // happens), so if either effect here or R3F's own sync ever became a
  // layout/passive pair in the other order, this would go back to a
  // permanently-frozen canvas with no signal that anything was wrong.
  // The next canvas (the classic-résumé round trip) gets a new WebGL context
  // and must load the scene's images again: ShaderWarmup let them go.
  useEffect(() => () => clearSceneAssets(), []);
  const wasFrozen = useRef(false);
  useEffect(() => {
    if (wasFrozen.current && !sceneFrozen) invalidate();
    wasFrozen.current = sceneFrozen;
  }, [sceneFrozen]);
  // Snapshot the ship's position the instant photo mode flips true so the orbit
  // target stays fixed for the session — deliberately NOT re-snapshotting every
  // frame (that would fight the user's orbit drag). Re-runs only when photoMode
  // itself toggles, not when flight.x/y/z change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const photoTarget = useMemo(() => new THREE.Vector3(flight.x, flight.y, flight.z), [photoMode]);

  return (
    // The dark fill shows only while the scene loads: once it draws, the
    // opaque sky covers every pixel, and a painted wrapper under it still
    // cost a full-window layer (~60 MB of the GPU process at 2×).
    <div className={`fixed inset-0 w-full h-full pointer-events-none z-0 ${sceneReady ? "" : "bg-[#020108]"}`}>
      <Canvas
        dpr={budgetDpr(window.innerWidth, window.innerHeight, window.devicePixelRatio)}
        // Relies on this Canvas never mounting with sceneFrozen already true
        // (mount always starts unlocked, and setShowClassicCV's breakOrbit()
        // call keeps the one other remount path — the classic-CV round trip
        // — from re-entering already locked). If that ever stopped holding,
        // R3F provides no initial paint for frameloop="never": invalidate()
        // and the internal invalidateInstance both no-op while frameloop is
        // "never", and CanvasImpl's mount effect never forces a frame. A
        // defensive advance() on mount was considered and deliberately left
        // out — Suspense for the ship/planet GLBs hasn't resolved at that
        // point, so it would paint an empty scene rather than a real one,
        // trading "blank" for "blank but misleadingly logged as painted."
        // Removing the one reachable mount-while-frozen path is the fix.
        frameloop={sceneFrozen ? "never" : "always"}
        gl={{
          // Off: the full tier draws into the composer's own targets and SMAA
          // smooths its edges, so a multisampled canvas only held ~76 MB at
          // 1512×802 (4 samples of colour and depth, plus the resolve) for a
          // final full-screen quad. Low-perf, which draws to the canvas
          // directly, goes without anti-aliasing: the cheaper tier is its job.
          antialias: false,
          alpha: true,
          powerPreference: "high-performance",
          // From the hull at 0.1 u to the far side of the system without
          // z-fighting (logDepth.ts): every custom shader writes it too.
          logarithmicDepthBuffer: LOG_DEPTH_BUFFER,
        }}
        // Far CAMERA_FAR (8000), not R3F's default 1000: the system is 7,200
        // across (SYSTEM_RADIUS 3600), so a body on its far side stays in view.
        camera={{ position: [SPAWN.x, SPAWN.y + 5, SPAWN.z + 8], fov: 60, far: CAMERA_FAR }}
        // Neutral rather than R3F's ACES default: it leaves in-gamut neon
        // colours nearly untouched and only rolls off highlights. PostFX's
        // ToneMapping pass uses the same curve, so the grade no longer shifts
        // when the low-perf tier unmounts the composer.
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping;
          // three restores a lost context by re-uploading every texture from
          // its image, and ShaderWarmup has let those go (sceneAssets.ts): a
          // fresh canvas loads them again instead.
          gl.domElement.addEventListener("webglcontextrestored", () => useSpaceStore.getState().remountCanvas(), { once: true });
        }}
        style={{ pointerEvents: "auto" }} // Listen for click spawning
        eventSource={document.getElementById("root") || undefined}
        eventPrefix="client"
      >
        <PixelBudget />
        <PerformanceMonitor
          onDecline={() => {
            const s = useSpaceStore.getState();
            if (!s.lowPerfManual && !s.isLowPerf) s.setLowPerf(true);
          }}
        />
        <Suspense fallback={<LoadProgress />}>
          <PackGate>
            {import.meta.env.DEV && <DebugBridge />}
            {import.meta.env.DEV && <PerfSampler />}

            {/* Static generated IBL: cool spacelight + warm sun echo. frames={1} renders it once.
                For the ship and the props: the bodies opt out (noIbl.ts, L29). */}
            <SpaceEnvironment />

            {/* Ambient galactic backdrop lighting; with the IBL above it falls
                off like the sunlight past 1 AU (ExposureDriver, L19) */}
            <ambientLight ref={registerFillAmbient} intensity={AMBIENT_BASE} />
            {/* The sun: single dominant light at the origin — gives every body a
                real day side and terminator (realistic-planets spec G2) */}
            {/* 2.1 at 1 AU, up from 2.0: absorbs Sun.tsx's second light at the
                origin (4.8, decay 0.8), which added only ~5% at planet distance
                and cost a full light in every lit fragment. Falls off as 1/d²
                since F3 (sunLight.ts). */}
            <SunLight />
            {/* The camera's exposure and the sun/overlay compensation (F3) */}
            <ExposureDriver />

            {/* Painted galactic sky (scene.background, rendered once) */}
            <SkyBackdrop />

            {/* Starfield particles */}
            <GalaxyStarfield isLowPerf={isLowPerf} />

            {/* Distant procedural spiral galaxies */}
            <DistantGalaxies />

            {/* Schedules comet passes, solar flares and cargo convoys (world events) */}
            <WorldEventDirector />

            {/* Spaceship craft */}
            <Spaceship />
            <TractorBeam />
            {/* The three project probes: grabbed by the beam, so after it */}
            <ProjectProbes />

            {/* The contact portal, the destinations and the nebulae */}
            <SpacePlanets />
            {/* The nine real bodies: textures load here, so ShaderWarmup compiles them */}
            <SolarBodies />
            {/* The nine major moons, insets about their planets (maps and the Phobos/Deimos GLBs load here) */}
            <SolarMoons />
            {/* Bodies under 2 px across as dots: after SolarBodies, which moves them */}
            <BodyDots />

            {/* Central sun core + corona/flare shell */}
            <Sun />

            {/* Scattered Deep Space Asteroids */}
            <Asteroids />

            {/* Asteroid Belt */}
            <AsteroidBelt />

            {/* NPC Cargo Traffic */}
            <CargoTraffic />

            {/* Energy Plasma particles spawner */}
            <PlasmaAnomalies ref={anomaliesRef} />

            {/* Pooled shooting star streaks */}
            {!isLowPerf && !reducedMotion && <ShootingStars />}

            {/* Warp tunnel around the ship during boost */}
            {!isLowPerf && !reducedMotion && <WarpTunnel />}

            {/* Rare drifting space jellyfish with undulation shader; J calls it as a guide */}
            <SpaceJellyfish />

            {/* Comets with anti-sunward tails */}
            <Comets />

            {/* Collectible data shards scattered across the system */}
            <DataShards />

            {/* Career station (dock for the Career dossier) and its buoy trail */}
            <CareerStation />
            <CareerTrail />
            <Shipyard />
            <DormantGate />

            {/* The ring race: the start gate, the course for racers, the best lap's ghost in a solo race */}
            <RaceCourse />

            {/* Visitors' bottles — only when the beacon API is configured, and Show bottles is on */}
            {BEACONS_ENABLED && <BottlesGate />}

            {/* Other pilots flying now — only when the live sky URL is configured */}
            {LIVE_SKY_ENABLED && <Ghosts />}

            {/* Headless: drives proximity scan targeting/progress/report dispatch */}
            <Scanner />

            {/* Headless: projects the next unread dossier for the HUD waypoint */}
            <WaypointDriver />

            {/* Clickable space trigger plane (follows ship and expanded to cover viewport).
                Unmounted in photo mode: R3F synthetic pointer events and OrbitControls
                share the same eventSource, so a drag-to-orbit pointerdown would also
                spawn a plasma anomaly into the clean frame — stopPropagation doesn't
                help across sibling listeners. */}
            {!photoMode && <FollowingClickPlane onSpawn={(p) => anomaliesRef.current?.spawn(p)} />}

            {/* Inside Suspense deliberately: the warm-up compiles the scene as
                it exists when it mounts, so as a sibling of the boundary it
                would run before any GLTF-dependent component had resolved and
                warm a near-empty scene. */}
            <ShaderWarmup />
          </PackGate>
        </Suspense>

        {/* Photo mode: free orbit around the ship's position at the moment of toggle */}
        {photoMode && <OrbitControls makeDefault enableDamping target={photoTarget} />}

        {/* Cinematic glow filters (outside Suspense so they don't unmount, protected by Error Boundary) */}
        {/* Always mounted; low-perf disables it (see PostFX) rather than
            unmounting, which recompiled Bloom/SMAA on every round trip. */}
        <SafeErrorBoundary>
          <PostFX enabled={!isLowPerf} />
        </SafeErrorBoundary>
      </Canvas>
    </div>
  );
}

/**
 * memo is load-bearing, not an optimisation. GlobalCanvas takes no props and
 * is rendered by App, which subscribes to ten store values (App.tsx:26-35).
 * Without memo, every activeZone / isOrbitLocked / isNearSpawn flip re-renders
 * the entire R3F tree mid-flight. The canvas reads what it needs from the
 * store directly, so it never needs props to arrive this way.
 *
 * Guarded by tests/e2e/transition.probe.mjs.
 */
export default memo(GlobalCanvas);
