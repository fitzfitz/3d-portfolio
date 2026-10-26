// First: the hue-keeping toe must be in the tone-mapping chunk before any program compiles (as GlobalCanvas).
import "../components/canvas/hueToe";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import * as THREE from "three";
import PostFX from "../components/canvas/PostFX";
import SpaceEnvironment from "../components/canvas/SpaceEnvironment";
import SkyBackdrop from "../components/canvas/SkyBackdrop";
import Sun from "../components/canvas/Sun";
import { CAMERA_FAR, LOG_DEPTH_BUFFER } from "../components/canvas/logDepth";
import { PLAYER_SHIP_SCALE } from "../constants";
import { contentSource, type ContentSource } from "../data/content";
import saucerRigJson from "../data/saucerRig.json";
import tardigradeRigJson from "../data/tardigradeRig.json";
import { useSpaceStore } from "../store/spaceStore";
import { assetUrl } from "../utils/assetUrl";
import { budgetDpr } from "../utils/pixelBudget";
import { useModel } from "../utils/sceneAssets";
import {
  AMBIENT_BASE, SUN_COLOR, SUN_LIGHT_INTENSITY, applyBackdrop, applyFill, cutExposure, fillLight, setExposureCompensation,
  stepExposure, targetExposure,
} from "../utils/sunLight";
import { MONSTER_UNIFORMS } from "../utils/monsters/monsterShading";
import { beginMonsterFrame, createLodState, endMonsterFrame } from "../utils/monsters/monsterInstances";
import { saucerTint, type SaucerTint } from "../utils/monsters/monsterTint";
import { addSaucer, saucerBoundsMargin, saucerMuzzle, type SaucerPose, type SaucerRig } from "../utils/monsters/saucerMaterial";
import {
  addTardigrade, tardigradeCurlPoint, type TardigradePose, type TardigradeRig,
} from "../utils/monsters/tardigradeMaterial";
import { buildSaucer, buildTardigrade, type LabMesh } from "./labMonsters";
import {
  CYCLE_SECONDS, LAB_STATES, clusterCentre, createSubmittedSnapshot, snapshotSubmitted, labQuery, heroKind, layoutFraming, layoutPlacements, monsterPhases, parseLabQuery,
  placementMatrix, saucerLabPose, tardigradeLabPose, type LabSettings, type MonsterKind,
} from "./labScene";
import LabPanel from "./LabPanel";

/**
 * The monster lab (dev only, /monster-lab.html; space monsters Task 6): the
 * two monsters live, with the game's renderer, light and post stack, so the
 * owner judges them as the game will show them, and the e2e probe
 * (tests/e2e/monsterlab.probe.mjs) proves the shaders and the budgets.
 *
 * Same as the game (GlobalCanvas): the Canvas gl options, Neutral tone
 * mapping with the hue-keeping toe, the log depth buffer, the sun as the one
 * point light at the origin (SUN_LIGHT_INTENSITY, decay 2, SUN_COLOR), the
 * ambient fill and the IBL (SpaceEnvironment) falling off with it, the
 * exposure law with EXPOSURE_LIFT (sunLight.ts), the painted sky, the Sun
 * itself and PostFX. No extra light. One difference: the exposure is metered
 * where the monsters are, not at the camera (the game's camera always rides
 * at the ship; the lab's orbit camera may stand 700 u off, which would meter
 * a different sunlight).
 *
 * The debug hook, window.__monsterLab: ready, stats() → { calls, triangles,
 * programs, diagnostics }, instances(), setState / setLayout / setPreset /
 * setLod / setSeed / setReducedMotion / setCycle, setHidden (the baseline),
 * setSolo, setCamera, frameMirror and mirror() (the TS mirrors on screen).
 * `ui=0` in the query hides the panel (clean screenshots; the probe's
 * pixel comparisons).
 */

const SAUCER_RIG = saucerRigJson as SaucerRig;
const TARDIGRADE_RIG = tardigradeRigJson as TardigradeRig;
/** Capacity per LOD level: the largest layout's count of each. */
const SAUCERS = 6;
const TARDIGRADES = 2;
/** The tardigrade's axis point the curl mirror check follows: near the tail, so curling carries it far. */
const MIRROR_AXIS_A = 0.06;
/** The saucer's aim for the mirror check (model space): well off its rest +Z, down and to its side. */
const MIRROR_AIM = new THREE.Vector3(1, -0.55, -0.25);

// ------------------------------------------------------------ settings ----

type Listener = () => void;
function createLabStore(initial: LabSettings) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<LabSettings>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
type LabStore = ReturnType<typeof createLabStore>;

/** Live readings for the panel. */
export interface LabReadings { calls: number; triangles: number; programs: number; fps: number; state: string }

/** The debug hook's shape (tests/e2e/monsterlab.probe.mjs). */
export interface MonsterLabHook {
  ready: boolean;
  /** Where this visit's content came from; the lab's entry (src/lab/main.tsx) settles it from the bundled snapshot before MonsterLab loads. */
  content: ContentSource;
  /**
   * One frame's numbers, all snapshotted in the same onAfterRender: the renderer's totals (calls, triangles),
   * what the monster meshes themselves drew that frame (monsterCalls, monsterTriangles, from their own
   * onBefore/onAfterRender deltas, so culled meshes are not counted and no other frame is involved),
   * and what the instance counts submitted.
   */
  stats(): { calls: number; triangles: number; monsterCalls: number; monsterTriangles: number; programs: number; diagnostics: number; submittedCalls: number; submittedTriangles: number; counts: number[] };
  /** Mesh metadata with `count` from the last snapshot (one frame behind the live instance count). */
  instances(): { name: string; model: string; lod: number; part: string; count: number; triangles: number }[];
  setState(s: string): void;
  setLayout(l: string): void;
  setPreset(p: string): void;
  setLod(l: string): void;
  setSeed(n: number): void;
  setReducedMotion(v: boolean): void;
  setCycle(v: boolean): void;
  setHidden(v: boolean): void;
  /** Hides only the saucers' glass (the dome-clarity probe compares with and without it). */
  setDomeHidden(v: boolean): void;
  /** The first saucer's dome on screen: centre x, y and radius, in CSS px (the radius from the dome's own bounds, without the motion margin). */
  domeDisc(): [number, number, number];
  setSolo(k: MonsterKind | null): void;
  setCamera(position: number[], target: number[]): void;
  /** Frames the solo monster for the mirror check; `posed` false puts the saucer's barrel back to its rest aim. */
  frameMirror(posed?: boolean): void;
  mirror(): Record<MonsterKind, { posed: number[]; rest: number[] }>;
}
declare global {
  interface Window { __monsterLab?: MonsterLabHook }
}

// --------------------------------------------------------------- scene ----

/** The scene's sun light, as GlobalCanvas's (no flare here: no world events run). */
function SunLight() {
  return <pointLight position={[0, 0, 0]} intensity={SUN_LIGHT_INTENSITY} decay={2} color={SUN_COLOR} />;
}

/**
 * The player's ship as a scale reference and the saucers' target, engines
 * off: its own materials, cloned with their emissive dropped (the game's
 * Spaceship drives the engine glow from the throttle, so a stand-in left at
 * the glb's would blaze under the far preset's exposure).
 */
function ShipStandIn({ visible }: { visible: boolean }) {
  const { scene } = useModel(assetUrl("/models/spaceship.glb"));
  const ship = useMemo(() => {
    const s = scene.clone();
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      if (mat.emissive) mat.emissiveIntensity = 0;
      m.material = mat;
    });
    return s;
  }, [scene]);
  return <primitive object={ship} visible={visible} scale={PLAYER_SHIP_SCALE} rotation={[0, Math.PI, 0]} />;
}

/** Spread only: a quiet tag over each monster, which sit 200 u apart (a few pixels each from where all eight show). */
function SpreadTags({ placements }: { placements: readonly { kind: MonsterKind; position: THREE.Vector3 }[] }) {
  let saucers = 0, tardigrades = 0;
  return (
    <>
      {placements.map((p, i) => {
        const label = p.kind === "saucer" ? `S${++saucers}` : `T${++tardigrades}`;
        return (
          <Html key={i} position={p.position} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className="flex flex-col items-center -translate-y-5 font-mono text-[10px] text-white/70 select-none">
              <span className="px-1 rounded bg-black/50 border border-white/15">{label}</span>
              <span className="w-px h-3 bg-white/30" />
            </div>
          </Html>
        );
      })}
    </>
  );
}

interface SceneProps { store: LabStore; readings: RefObject<LabReadings> }
/** What the lab needs of drei's OrbitControls. */
type Orbit = { target: THREE.Vector3; update(): void };

function LabScene({ store, readings }: SceneProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Orbit | null;
  const settings = useSyncExternalStore(store.subscribe, store.get);

  const saucerGltf = useModel(assetUrl("/models-lab/saucer.glb"));
  const tardigradeGltf = useModel(assetUrl("/models-lab/tardigrade.glb"));
  const saucer = useMemo(() => buildSaucer(saucerGltf.scene, SAUCER_RIG, SAUCERS), [saucerGltf]);
  const tardigrade = useMemo(() => buildTardigrade(tardigradeGltf.scene, TARDIGRADE_RIG, TARDIGRADES), [tardigradeGltf]);
  const meshes: LabMesh[] = useMemo(() => [...saucer.meshes, ...tardigrade.meshes], [saucer, tardigrade]);
  const all = useMemo(() => meshes.map((m) => m.mesh), [meshes]);
  useEffect(() => () => {
    for (const m of meshes) { m.mesh.geometry.dispose(); m.mesh.dispose(); }
  }, [meshes]);

  const groupRef = useRef<THREE.Group>(null);
  const centre = useMemo(() => clusterCentre(settings.preset), [settings.preset]);
  const placements = useMemo(() => layoutPlacements(settings.layout), [settings.layout]);
  const matrices = useMemo(() => placements.map((p) => placementMatrix(p)), [placements]);
  const inverseRotations = useMemo(() => matrices.map((m) => {
    const q = new THREE.Quaternion();
    m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    return q.invert();
  }), [matrices]);
  const framing = useMemo(() => layoutFraming(settings.layout, settings.cam), [settings.layout, settings.cam]);
  /** Where the exposure is metered: the monsters' mean distance from the sun. */
  const meter = useMemo(() => placements.reduce((d, p) => d + p.position.clone().add(centre).length(), 0) / placements.length,
    [placements, centre]);
  const tints = useMemo(() => {
    const out: SaucerTint[] = [];
    placements.forEach((p, i) => { if (p.kind === "saucer") out[i] = saucerTint(settings.seed + i); });
    return out;
  }, [placements, settings.seed]);
  const phases = useMemo(() => monsterPhases(settings.seed, placements.length), [settings.seed, placements]);
  /** One LOD state per placement: the hysteresis band needs each monster's last level (fresh per layout). */
  const lodStates = useMemo(() => placements.map(() => createLodState()), [placements]);
  const lodSets = useMemo(() => ({
    saucer: { "0": [saucer.lods[0]], "1": [saucer.lods[1]], auto: saucer.lods },
    tardigrade: { "0": [tardigrade.lods[0]], "1": [tardigrade.lods[1]], auto: tardigrade.lods },
  }), [saucer, tardigrade]);

  // Mutable per-frame state (no React renders per frame).
  const live = useRef({
    hidden: false, solo: null as MonsterKind | null, aimOverride: null as THREE.Vector3 | null,
    stateStart: 0, cycleStart: 0, lastState: settings.state, cutExposure: true, frames: 0,
    calls: 0, triangles: 0, monsterCalls: 0, monsterTriangles: 0, curl: 0,
  });
  const submitted = useMemo(() => createSubmittedSnapshot(meshes.length), [meshes]);
  const poses = useMemo(() => ({
    saucer: { phase: 0, look: new THREE.Vector3(), aim: new THREE.Vector3(), chase: -1, fire: 0, hit: 0, defeat: 0, blink: 0 } as SaucerPose,
    tardigrade: { phase: 0, swim: 0, charge: 0, recoil: 0, hit: 0, curl: 0 } as TardigradePose,
    lastAim: new THREE.Vector3(0, 0, 1),
  }), []);
  const tmp = useMemo(() => ({
    world: new THREE.Vector3(), target: new THREE.Vector3(), toTarget: new THREE.Vector3(), toShip: new THREE.Vector3(),
    ship: new THREE.Vector3(), m: new THREE.Matrix4(),
  }), []);

  // The camera: each layout's (and preset's) default framing; the owner orbits from there.
  useEffect(() => {
    camera.position.copy(centre).add(framing.camera);
    camera.near = settings.layout === "spread" ? 1 : 0.1;
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(centre).add(framing.target);
      controls.update();
    }
    live.current.cutExposure = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre, framing, controls]);

  // Reduced motion reaches the game's own pieces too (the Sun's ambient motion).
  useEffect(() => { useSpaceStore.getState().setReducedMotion(settings.reducedMotion); }, [settings.reducedMotion]);

  // The renderer's counters for the scene's own render (PostFX renders it in a pass; see PerfSampler).
  useEffect(() => {
    const L = live.current;
    const prev = scene.onAfterRender;
    const prevBefore = scene.onBeforeRender;
    // The monsters' own draws, as renderer-counter deltas around each mesh (same frame as the totals).
    let mCalls = 0, mTriangles = 0, c0 = 0, t0 = 0;
    scene.onBeforeRender = () => { mCalls = 0; mTriangles = 0; };
    const saved = meshes.map((m) => [m.mesh.onBeforeRender, m.mesh.onAfterRender] as const);
    meshes.forEach((m) => {
      m.mesh.onBeforeRender = () => { c0 = gl.info.render.calls; t0 = gl.info.render.triangles; };
      m.mesh.onAfterRender = () => { mCalls += gl.info.render.calls - c0; mTriangles += gl.info.render.triangles - t0; };
    });
    scene.onAfterRender = () => {
      L.calls = gl.info.render.calls;
      L.triangles = gl.info.render.triangles;
      L.monsterCalls = mCalls;
      L.monsterTriangles = mTriangles;
      snapshotSubmitted(meshes, submitted);
    };
    return () => {
      scene.onAfterRender = prev;
      scene.onBeforeRender = prevBefore;
      meshes.forEach((m, i) => { m.mesh.onBeforeRender = saved[i][0]; m.mesh.onAfterRender = saved[i][1]; });
    };
  }, [scene, gl, meshes, submitted]);

  useFrame((state, delta) => {
    const L = live.current;
    const s = store.get();
    const t = state.clock.elapsedTime;
    // Exposure, fill and backdrop for the monsters' distance from the sun (sunLight.ts).
    applyFill(scene, meter);
    applyBackdrop(scene, meter);
    if (L.cutExposure) {
      cutExposure(gl, meter, true);
      L.cutExposure = false;
    } else {
      const e = stepExposure(gl.toneMappingExposure, targetExposure(meter), delta, s.reducedMotion);
      gl.toneMappingExposure = e;
      // Unconditional: the lab always runs PostFX (the game passes !isLowPerf,
      // GlobalCanvas), so the post pass exposes and the compensation is 1/exposure.
      // The monsters' emissives (R22) read it.
      setExposureCompensation(e, true);
    }

    // The state, cycling if asked.
    if (s.state !== L.lastState) { L.lastState = s.state; L.stateStart = t; }
    let st = s.state;
    let ts = t - L.stateStart;
    if (s.cycle) {
      const k = Math.floor((t - L.cycleStart) / CYCLE_SECONDS);
      st = LAB_STATES[((k % LAB_STATES.length) + LAB_STATES.length) % LAB_STATES.length];
      ts = (t - L.cycleStart) - k * CYCLE_SECONDS;
      if (st !== s.state) { L.lastState = st; store.set({ state: st }); }
    } else {
      L.cycleStart = t - (LAB_STATES.indexOf(s.state) * CYCLE_SECONDS) - ts;
    }

    MONSTER_UNIFORMS.uTime.value = t;
    MONSTER_UNIFORMS.uMotion.value = s.reducedMotion ? 0 : 1;
    beginMonsterFrame(all);
    if (!L.hidden) {
      const group = groupRef.current;
      tmp.ship.copy(centre);
      const soloKind = L.solo ?? heroKind(s.cam);
      const solos = { saucer: false, tardigrade: false };
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        if (soloKind && (p.kind !== soloKind || solos[p.kind])) continue;
        solos[p.kind] = true;
        tmp.world.copy(p.position).add(centre);
        const distance = camera.position.distanceTo(tmp.world);
        // Look target: the camera for `look` (and wherever there is no ship), else the ship.
        tmp.target.copy(framing.ship ? tmp.ship : camera.position);
        tmp.toShip.copy(tmp.target).sub(tmp.world).applyQuaternion(inverseRotations[i]);
        tmp.toTarget.copy(camera.position).sub(tmp.world).applyQuaternion(inverseRotations[i]);
        if (p.kind === "saucer") {
          const pose = saucerLabPose(st, ts, phases[i], s.reducedMotion, tmp.toTarget, tmp.toShip, poses.saucer);
          if (L.aimOverride) pose.aim.copy(L.aimOverride);
          if (i === firstOf(placements, "saucer")) poses.lastAim.copy(pose.aim);
          addSaucer(lodSets.saucer[s.lod], SAUCER_RIG, matrices[i], distance, pose, tints[i], lodStates[i]);
        } else {
          const pose = tardigradeLabPose(st, ts, phases[i], s.reducedMotion, poses.tardigrade);
          if (i === firstOf(placements, "tardigrade")) L.curl = pose.curl;
          addTardigrade(lodSets.tardigrade[s.lod], TARDIGRADE_RIG, matrices[i], distance, pose, lodStates[i]);
        }
      }
      if (group) group.updateMatrixWorld();
    }
    endMonsterFrame(all);
    L.frames++;
    readings.current.state = st;
    readings.current.calls = L.calls;
    readings.current.triangles = L.triangles;
    readings.current.programs = gl.info.programs?.length ?? 0;
    readings.current.fps = readings.current.fps * 0.95 + (delta > 0 ? 1 / delta : 0) * 0.05;
    if (L.frames === 5 && window.__monsterLab) window.__monsterLab.ready = true;
  });

  // The debug hook.
  useEffect(() => {
    const L = live.current;
    const project = (local: THREE.Vector3, i: number) => {
      tmp.m.copy(matrices[i]);
      const p = local.clone().applyMatrix4(tmp.m).add(centre).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return [(p.x + 1) / 2 * r.width + r.left, (1 - p.y) / 2 * r.height + r.top];
    };
    const hook: MonsterLabHook = {
      ready: window.__monsterLab?.ready ?? false,
      content: contentSource(),
      stats: () => ({
        calls: L.calls, triangles: L.triangles, monsterCalls: L.monsterCalls, monsterTriangles: L.monsterTriangles,
        submittedCalls: submitted.calls, submittedTriangles: submitted.triangles, counts: Array.from(submitted.counts),
        programs: gl.info.programs?.length ?? 0,
        diagnostics: (gl.info.programs ?? []).filter((p) => (p as unknown as { diagnostics?: unknown }).diagnostics).length,
      }),
      instances: () => meshes.map((m, i) => ({ name: m.mesh.name, model: m.model, lod: m.lod, part: m.part, count: submitted.counts[i], triangles: m.triangles })),
      setState: (v) => store.set({ state: v as LabSettings["state"], cycle: false }),
      setLayout: (v) => store.set({ layout: v as LabSettings["layout"] }),
      setPreset: (v) => store.set({ preset: v as LabSettings["preset"] }),
      setLod: (v) => store.set({ lod: v as LabSettings["lod"] }),
      setSeed: (v) => store.set({ seed: Math.floor(v) }),
      setReducedMotion: (v) => store.set({ reducedMotion: v }),
      setCycle: (v) => store.set({ cycle: v }),
      setHidden: (v) => { L.hidden = v; },
      setDomeHidden: (v) => { for (const m of meshes) if (m.part === "dome") m.mesh.visible = !v; },
      domeDisc: () => {
        const i = firstOf(placements, "saucer");
        const g = saucer.lods[0].dome.geometry;
        if (i < 0 || !g.boundingSphere) return [NaN, NaN, NaN];
        const c = g.boundingSphere.center, r = g.boundingSphere.radius - saucerBoundsMargin(SAUCER_RIG);
        const [x, y] = project(c, i);
        // the radius on screen: a point r to the camera's right of the centre
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const e = c.clone().applyMatrix4(matrices[i]).add(centre).addScaledVector(right, r).project(camera);
        const rect = gl.domElement.getBoundingClientRect();
        return [x, y, Math.abs((e.x + 1) / 2 * rect.width + rect.left - x)];
      },
      setSolo: (k) => { L.solo = k; if (!k) L.aimOverride = null; },
      setCamera: (position, target) => {
        camera.position.set(position[0], position[1], position[2]).add(centre);
        controls?.target.set(target[0], target[1], target[2]).add(centre);
        controls?.update();
      },
      frameMirror: (posed = true) => {
        const kind = L.solo ?? "saucer";
        const i = firstOf(placements, kind);
        if (i < 0) return;
        const pos = placements[i].position;
        const rot = inverseRotations[i].clone().invert();
        if (kind === "saucer") {
          L.aimOverride = posed ? MIRROR_AIM.clone() : new THREE.Vector3(0, 0, 1);
          // From the saucer's side, a little above the barrel's plane, so space lies behind both muzzle points.
          const eye = new THREE.Vector3(-1.2, -0.75, 3.6).applyQuaternion(rot).add(pos);
          const at = new THREE.Vector3(...SAUCER_RIG.pivots.cannon).applyQuaternion(rot).add(pos);
          hook.setCamera(eye.toArray(), at.toArray());
        } else {
          // Square to the body's side, the whole animal in frame.
          const eye = new THREE.Vector3(-11, 1.5, 0.4).applyQuaternion(rot).add(pos);
          const at = new THREE.Vector3(...TARDIGRADE_RIG.curlCentre).applyQuaternion(rot).add(pos);
          hook.setCamera(eye.toArray(), at.toArray());
        }
      },
      mirror: () => {
        const si = firstOf(placements, "saucer"), ti = firstOf(placements, "tardigrade");
        const muzzle = saucerMuzzle(poses.lastAim, SAUCER_RIG, new THREE.Vector3());
        const restMuzzle = new THREE.Vector3(...SAUCER_RIG.muzzle);
        const curled = tardigradeCurlPoint(MIRROR_AXIS_A, L.curl, TARDIGRADE_RIG, new THREE.Vector3());
        const straight = tardigradeCurlPoint(MIRROR_AXIS_A, 0, TARDIGRADE_RIG, new THREE.Vector3());
        return {
          saucer: si < 0 ? { posed: [NaN, NaN], rest: [NaN, NaN] } : { posed: project(muzzle, si), rest: project(restMuzzle, si) },
          tardigrade: ti < 0 ? { posed: [NaN, NaN], rest: [NaN, NaN] } : { posed: project(curled, ti), rest: project(straight, ti) },
        };
      },
    };
    window.__monsterLab = hook;
  }, [store, gl, camera, controls, meshes, submitted, matrices, placements, inverseRotations, centre, poses, tmp]);

  return (
    <group ref={groupRef} position={centre}>
      {all.map((m) => <primitive key={m.uuid} object={m} />)}
      <ShipStandIn visible={framing.ship} />
      {settings.layout === "spread" && <SpreadTags placements={placements} />}
    </group>
  );
}

const firstOf = (placements: readonly { kind: MonsterKind }[], kind: MonsterKind) => placements.findIndex((p) => p.kind === kind);

/** Registers the fill ambient with the fill law (sunLight.ts), as GlobalCanvas's does. */
function registerFillAmbient(light: THREE.AmbientLight | null) {
  fillLight.ambient = light;
}

export default function MonsterLab() {
  const store = useMemo(() => createLabStore(parseLabQuery(window.location.search,
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)), []);
  const settings = useSyncExternalStore(store.subscribe, store.get);
  const readings = useRef<LabReadings>({ calls: 0, triangles: 0, programs: 0, fps: 0, state: settings.state });
  const [shown, setShown] = useState<LabReadings>(readings.current);

  // The URL follows the panel, so a view can be shared or reloaded.
  const ui = useMemo(() => new URLSearchParams(window.location.search).get("ui") !== "0", []);
  useEffect(() => { window.history.replaceState(null, "", `?${labQuery(settings)}${ui ? "" : "&ui=0"}`); }, [settings, ui]);
  useEffect(() => {
    const id = window.setInterval(() => setShown({ ...readings.current }), 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas
        dpr={budgetDpr(window.innerWidth, window.innerHeight, window.devicePixelRatio)}
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance", logarithmicDepthBuffer: LOG_DEPTH_BUFFER }}
        camera={{ fov: 60, far: CAMERA_FAR, position: [0, 0, 20] }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}
      >
        <Suspense fallback={null}>
          <SpaceEnvironment />
          <ambientLight ref={registerFillAmbient} intensity={AMBIENT_BASE} />
          <SunLight />
          <Sun />
          <SkyBackdrop />
          <LabScene store={store} readings={readings} />
        </Suspense>
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <PostFX enabled />
      </Canvas>
      {ui && <LabPanel settings={settings} readings={shown} onChange={(patch) => store.set(patch)} />}
    </div>
  );
}
