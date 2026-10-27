import { Suspense, useEffect, useMemo, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { combat, flight, useSpaceStore } from "../../../store/spaceStore";
import { fitzDebug } from "../../../debug/bridge";
import { useModel } from "../../../utils/sceneAssets";
import { assetUrl } from "../../../utils/assetUrl";
import { gameTime } from "../../../utils/ambientTime";
import saucerRigJson from "../../../data/saucerRig.json";
import tardigradeRigJson from "../../../data/tardigradeRig.json";
import { MAX_SAUCERS, MAX_TARDIGRADES } from "../../../utils/combat/constants";
import { monsterMatrix } from "../../../utils/combat/monsterFrame";
import {
  monsterFrameNeeded, monstersOnShow, nestPhase, saucerRenderPose, sleepBob, tardigradeRenderPose,
} from "../../../utils/combat/renderPose";
import { MONSTER_UNIFORMS } from "../../../utils/monsters/monsterShading";
import { beginMonsterFrame, createLodState, endMonsterFrame } from "../../../utils/monsters/monsterInstances";
import { saucerTint, type SaucerTint } from "../../../utils/monsters/monsterTint";
import { addSaucer } from "../../../utils/monsters/saucerMaterial";
import { addTardigrade } from "../../../utils/monsters/tardigradeMaterial";
import { buildSaucer, buildTardigrade } from "../../../utils/monsters/buildMonsters";
import { SAUCER_GLB, TARDIGRADE_GLB } from "../../../utils/monsters/monsterAssets";
import type { SaucerPose, SaucerRig, TardigradePose, TardigradeRig } from "../../../utils/monsters/monsterRig";
import { warmNest } from "./nestWarmup";
import { nestEffectMeshes } from "./nestEffectMeshes";
import { markNestLoadFailed } from "../../../utils/combat/nestHud";
import SafeErrorBoundary from "../SafeErrorBoundary";
import NestEffects from "./NestEffects";
import NestCluster from "./NestCluster";

const SAUCER_RIG = saucerRigJson as SaucerRig;
const TARDIGRADE_RIG = tardigradeRigJson as TardigradeRig;

const onLoadError = () => markNestLoadFailed(combat);

/**
 * The lazily loaded chunk's root, which NestGate mounts within the load
 * radius (Ruling C27): the effects (NestEffects) and the warm-up
 * (nestWarmup, called by Monsters) load in this chunk, not the canvas's
 * startup code. The effects mount as soon as the chunk arrives, without
 * waiting for the glbs, and stay if the glbs fail (offline, say), as they did
 * when NestGate mounted them: the ship's own bolts still draw in the Nest.
 * The monsters' own Suspense and error boundary keep their load from hiding
 * the effects; a failed glb load marks `combat.loadFailed` (Ruling C22).
 * Both sit under NestGate's Nest group (`warmRoot`), as before, so the
 * warm-up walks the same tree; so does the rock cluster and its glow
 * (NestCluster), which mount beside the effects with a Suspense of their own.
 */
export default function NestMonsters({ warmRoot }: { warmRoot: RefObject<THREE.Group | null> }) {
  return (
    <>
      <NestEffects />
      {/* The rock cluster and the glow: their own Suspense (asteroids.glb is the scenery's, normally cached), so they never hide the effects or the monsters. */}
      <SafeErrorBoundary>
        <Suspense fallback={null}>
          <NestCluster />
        </Suspense>
      </SafeErrorBoundary>
      <SafeErrorBoundary onError={onLoadError}>
        <Suspense fallback={null}>
          <Monsters warmRoot={warmRoot} />
        </Suspense>
      </SafeErrorBoundary>
    </>
  );
}

/**
 * The Nest's monsters (spec 2026-10-27-combat), the lazily loaded renderer:
 * NestGate imports this chunk (the materials, the shading and the
 * instancing, ~23 kB min) and its two glbs only once the ship comes within
 * the 200 u load radius (Ruling C16). Driven as the monster lab drives them
 * (src/lab/MonsterLab.tsx): every frame the shared uniforms (uTime the game
 * time, uMotion 0 under reduced motion), then beginMonsterFrame, one
 * addSaucer / addTardigrade per monster still on show (alive, defeated or
 * leaving: not gone), endMonsterFrame. Poses come from the AI
 * (utils/combat/renderPose.ts adds phase, look and blink, in model space);
 * sleepers (asleep: blink held shut) bob by sleepBob.
 * Saucers draw 4 calls per LOD level in use, the tardigrade 3.
 *
 * On mount it compiles its programs and uploads its maps (warmNest), then
 * sets `combat.warm`, which lets wave 1 start; on unmount it clears it, so a
 * remounted canvas warms again before the next wave.
 */
function Monsters({ warmRoot }: { warmRoot: RefObject<THREE.Group | null> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const saucerGltf = useModel(assetUrl(SAUCER_GLB));
  const tardigradeGltf = useModel(assetUrl(TARDIGRADE_GLB));
  const saucer = useMemo(() => buildSaucer(saucerGltf.scene, SAUCER_RIG, MAX_SAUCERS), [saucerGltf]);
  const tardigrade = useMemo(() => buildTardigrade(tardigradeGltf.scene, TARDIGRADE_RIG, MAX_TARDIGRADES), [tardigradeGltf]);
  const meshes = useMemo(() => [...saucer.meshes, ...tardigrade.meshes], [saucer, tardigrade]);
  const all = useMemo(() => meshes.map((m) => m.mesh), [meshes]);
  useEffect(() => () => {
    for (const m of meshes) { m.mesh.geometry.dispose(); m.mesh.dispose(); }
  }, [meshes]);

  // Per slot, reused every frame: the pose, the tint (made at each spawn: the seed changes) and the LOD state.
  const slots = useMemo(() => ({
    saucers: Array.from({ length: MAX_SAUCERS }, (_, i) => ({
      pose: { phase: 0, look: new THREE.Vector3(), aim: new THREE.Vector3(), chase: -1, fire: 0, hit: 0, defeat: 0, blink: 0 } as SaucerPose,
      tint: saucerTint(0) as SaucerTint, seed: -1, lod: createLodState(), phase: nestPhase(i),
    })),
    tardigrades: Array.from({ length: MAX_TARDIGRADES }, (_, i) => ({
      pose: { phase: 0, swim: 0, charge: 0, recoil: 0, hit: 0, curl: 0 } as TardigradePose,
      lod: createLodState(), phase: nestPhase(MAX_SAUCERS + i),
    })),
    m: new THREE.Matrix4(), p: new THREE.Vector3(), ship: { x: 0, y: 0, z: 0 },
    /** A monster was on show last frame (Ruling C21). */
    shownLast: true,
  }), []);

  // Warm the programs and maps, then open the warm gate for wave 1.
  useEffect(() => {
    let cancelled = false;
    const root = warmRoot.current;
    if (!root) return;
    const s = useSpaceStore.getState();
    const postFx = !(s.pendingLowPerf ?? s.isLowPerf);
    warmNest(gl, root, camera, scene, postFx).then(() => { if (!cancelled) { combat.warm = true; combat.loadFailed = false; } });
    return () => { cancelled = true; combat.warm = false; };
  }, [gl, camera, scene, warmRoot]);

  // The debug handle (dev only): the always-loaded NestDirector reads uMotion through it.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.nestRender = {
      motion: () => MONSTER_UNIFORMS.uMotion.value,
      instances: () => meshes.map((m) => ({ name: m.mesh.name, count: m.mesh.count })),
      effects: () => nestEffectMeshes.meshes.map((o) => ({
        name: o.name,
        count: !o.visible ? 0 : (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : o.geometry.drawRange.count,
      })),
    };
    return () => { fitzDebug.nestRender = null; };
  }, [meshes]);

  useFrame((state) => {
    const st = useSpaceStore.getState();
    const reduced = st.reducedMotion;
    const t = gameTime(state.clock.getElapsedTime());
    MONSTER_UNIFORMS.uTime.value = t;
    MONSTER_UNIFORMS.uMotion.value = reduced ? 0 : 1;
    const n = combat.nest;
    const S = slots;
    // Nothing on show this frame or last: the meshes are already empty, so
    // skip the instance frame (no buffer upload or bounds refit) (C21).
    const show = monstersOnShow(n);
    const run = monsterFrameNeeded(show, S.shownLast);
    S.shownLast = show;
    if (!run) return;
    S.ship.x = flight.x; S.ship.y = flight.y; S.ship.z = flight.z;
    const cam = camera.position;
    beginMonsterFrame(all);
    for (let i = 0; i < n.saucers.length; i++) {
      const s = n.saucers[i];
      if (s.phase === "gone" || !(s.scale > 0)) continue;
      const slot = S.saucers[i];
      if (slot.seed !== s.seed) { slot.seed = s.seed; saucerTint(s.seed, slot.tint); }
      // A sleeper bobs (render-only; none under reduced motion).
      const bob = s.phase === "asleep" ? sleepBob(t, slot.phase, reduced) : 0;
      monsterMatrix(s.x, s.y + bob, s.z, s.fx, s.fy, s.fz, s.scale, S.m);
      const distance = S.p.set(s.x, s.y, s.z).distanceTo(cam);
      saucerRenderPose(s, S.m, S.ship, t, slot.phase, reduced, slot.pose);
      addSaucer(saucer.lods, SAUCER_RIG, S.m, distance, slot.pose, slot.tint, slot.lod);
    }
    for (let i = 0; i < n.tardigrades.length; i++) {
      const g = n.tardigrades[i];
      if (g.phase === "gone" || !(g.scale > 0)) continue;
      const slot = S.tardigrades[i];
      const bob = g.phase === "asleep" ? sleepBob(t, slot.phase, reduced) : 0;
      monsterMatrix(g.x, g.y + bob, g.z, g.fx, g.fy, g.fz, g.scale, S.m);
      const distance = S.p.set(g.x, g.y, g.z).distanceTo(cam);
      tardigradeRenderPose(g, slot.phase, slot.pose);
      addTardigrade(tardigrade.lods, TARDIGRADE_RIG, S.m, distance, slot.pose, slot.lod);
    }
    endMonsterFrame(all);
  });

  return <>{all.map((m) => <primitive key={m.uuid} object={m} />)}</>;
}
