import { Canvas, useFrame, useThree, invalidate } from "@react-three/fiber";
import { Html, AdaptiveDpr, PerformanceMonitor, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Suspense, useRef, useMemo, useEffect, useLayoutEffect, memo } from "react";
import * as THREE from "three";
import { makeStarMaterial } from "./starLayer";
import { softSprite } from "./softSprite";
import Spaceship from "./Spaceship";
import TractorBeam from "./TractorBeam";
import SpacePlanets from "./SpacePlanets";
import Sun from "./Sun";
import { PlasmaAnomalies } from "./PlasmaAnomalies";
import type { AnomaliesRef } from "./PlasmaAnomalies";
import PostFX from "./PostFX";
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
import RingCourse from "./RingCourse";
import Beacons from "./Beacons";
import Ghosts from "./Ghosts";
import { liveSkyUrl } from "../../utils/liveSky";
import { beaconApiUrl } from "../../utils/beaconApi";
import FuelCrystals from "./FuelCrystals";
import Scanner from "./Scanner";
import WaypointDriver from "./WaypointDriver";
import SkyBackdrop from "./SkyBackdrop";
import { flight, useSpaceStore, selectSceneFrozen, worldEventElapsed } from "../../store/spaceStore";
import { flareLevel } from "../../utils/worldEvents";
import DebugBridge from "../../debug/DebugBridge";
import PerfSampler from "../../debug/PerfSampler";
import { fitzDebug } from "../../debug/bridge";

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
    <points ref={pointsRef} name="StarLayer" material={material}>
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
      const textures = new Set<THREE.Texture>();
      scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
        }
      });
      const queue = [...textures];
      const step = () => {
        if (cancelled) return;
        const t = queue.pop();
        if (t) { gl.initTexture(t); setTimeout(step, 0); return; }
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
const LIVE_SKY_ENABLED = !!liveSkyUrl();

/** The scene's one sun light; a world-event flare lifts it 2.1 → 3.2 (no new light). */
function SunLight() {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (ref.current) ref.current.intensity = 2.1 + 1.1 * flareLevel(worldEventElapsed("flare"));
  });
  return <pointLight ref={ref} position={[0, 0, 0]} intensity={2.1} decay={0} color="#fff4e0" />;
}

function GlobalCanvas() {
  if (import.meta.env.DEV) fitzDebug.canvasRenderCount++;
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const photoMode = useSpaceStore((s) => s.photoMode);
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
    <div className="fixed inset-0 w-full h-full pointer-events-none z-0 bg-[#020108]">
      <Canvas
        dpr={[1, 1.5]}
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
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        camera={{ position: [0, 5, 8], fov: 60 }}
        // Neutral rather than R3F's ACES default: it leaves in-gamut neon
        // colours nearly untouched and only rolls off highlights. PostFX's
        // ToneMapping pass uses the same curve, so the grade no longer shifts
        // when the low-perf tier unmounts the composer.
        onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}
        style={{ pointerEvents: "auto" }} // Listen for click spawning
        eventSource={document.getElementById("root") || undefined}
        eventPrefix="client"
      >
        <AdaptiveDpr pixelated />
        <PerformanceMonitor
          onDecline={() => {
            const s = useSpaceStore.getState();
            if (!s.lowPerfManual && !s.isLowPerf) s.setLowPerf(true);
          }}
        />
        <Suspense fallback={<LoadProgress />}>
          {import.meta.env.DEV && <DebugBridge />}
          {import.meta.env.DEV && <PerfSampler />}

          {/* Static generated IBL: cool spacelight + warm sun echo. frames={1} renders it once. */}
          <Environment resolution={64} frames={1}>
            <color attach="background" args={["#050310"]} />
            <Lightformer form="rect" intensity={1.1} color="#3a4a8f" position={[0, 8, -10]} scale={[14, 7, 1]} />
            <Lightformer form="rect" intensity={0.7} color="#ff5500" position={[9, -3, 4]} scale={[8, 4, 1]} />
            <Lightformer form="rect" intensity={0.6} color="#00f0ff" position={[-9, 2, 5]} scale={[6, 6, 1]} />
          </Environment>

          {/* Ambient galactic backdrop lighting */}
          <ambientLight intensity={0.15} />
          {/* The sun: single dominant light at the origin — gives every body a
              real day side and terminator (realistic-planets spec G2) */}
          {/* 2.1, up from 2.0: absorbs Sun.tsx's second light at the origin
              (4.8, decay 0.8), which added only ~5% at planet distance and
              cost a full light in every lit fragment. */}
          <SunLight />

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

          {/* Orbiting planets */}
          <SpacePlanets />

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

          {/* Rare drifting space jellyfish with undulation shader (J to summon) */}
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

          {/* Time-trial ring course from the spawn pad, with a ghost of the best lap */}
          <RingCourse />

          {/* Visitors' beacons — only when the beacon API is configured */}
          {BEACONS_ENABLED && <Beacons />}

          {/* Other pilots flying now — only when the live sky URL is configured */}
          {LIVE_SKY_ENABLED && <Ghosts />}

          {/* Floating warp-fuel crystals */}
          <FuelCrystals />

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
