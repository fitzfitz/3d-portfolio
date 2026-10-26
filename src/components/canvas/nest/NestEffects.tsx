import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { combat, useSpaceStore } from "../../../store/spaceStore";
import { exposureCompensation } from "../../../utils/sunLight";
import { PLUME_COLORS } from "../../../data/plumeColors";
import { softSprite } from "../softSprite";
import { BOLT_POOL, BOLT_R, JET_RANGE, MAX_SAUCERS, MAX_TARDIGRADES } from "../../../utils/combat/constants";
import { nestPaused } from "../../../utils/combat/nestRadio";
import {
  ENEMY_BOLT_HEX, JET_HEX, JET_PARTICLES, SMOKE_POOL, THRUST_HEX, boltMatrix, createSmoke, jetParticle, nearFade, smokeAlpha,
  stepSmoke, thrustMatrix,
} from "../../../utils/combat/effects";
import type { V3 } from "../../../utils/combat/types";
import { nestEffectMeshes } from "./nestEffectMeshes";

/** Bolts glow past the bloom threshold: × this on their colour. */
const BOLT_GLOW = 2.6;
const THRUST_GLOW = 1.3;
const JET_GLOW = 2.2;
/** A ship bolt's and an enemy bolt's glowing length (u): longer for the faster ship bolt. */
const SHIP_BOLT_LENGTH = 1.8;
const ENEMY_BOLT_LENGTH = 1.2;
/** Glow radius: the bolt's hit radius and a little haze. */
const BOLT_GLOW_R = BOLT_R + 0.08;
/** The jet's particle size and the far end's share of its brightness. */
const JET_SIZE = 1.4;
const JET_FAR = 0.35;
/** The smoke's grey (lit dust, compensated like the overlays so it reads the same at any exposure) and puff size. */
const SMOKE_GREY: readonly [number, number, number] = [0.42, 0.4, 0.38];
const SMOKE_SIZE = 2.2;

const BOLTS = BOLT_POOL + MAX_SAUCERS;
const JETS = JET_PARTICLES * MAX_TARDIGRADES;

/**
 * The Nest's effects (spec 2026-10-27-combat), mounted by NestGate within the
 * load radius. Three draw calls at most, each pooled and written every frame
 * from `combat.nest`, its count set to what is live, nothing allocated:
 *  - one additive InstancedMesh for every bolt, the ship's in its plume
 *    colour and the saucers' green-yellow, plus a thrust glow under each live
 *    saucer scaled by its speed. RaceCourse's ring material configuration
 *    (MeshBasic, additive, instance colours, toneMapped off), so its program;
 *  - one Points for the tardigrade's plasma jet (the ship sparks' exact
 *    PointsMaterial settings, so their program);
 *  - one Points for the smoke trailing each defeated saucer for its 3 s
 *    drift (normal blending, vertex alphas).
 * A paused fight freezes them (dt 0). Each draws only while it has something
 * to show. The jet's and the smoke's sprites fade out within a few units of
 * the camera (effects.ts nearFade), so none fills the screen as it passes.
 */
export default function NestEffects() {
  const bolts = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, BOLTS);
    // Before the warm-up compiles it: a colour buffer made on first use would recompile.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BOLTS * 3), 3);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false; // spread over the fighting area, rewritten every frame
    mesh.name = "NestBolts";
    return mesh;
  }, []);

  const jet = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(JETS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(JETS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({
      vertexColors: true, size: JET_SIZE, map: softSprite, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.visible = false;
    points.name = "NestJet";
    return points;
  }, []);

  const smoke = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SMOKE_POOL * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(SMOKE_POOL * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({
      vertexColors: true, size: SMOKE_SIZE, map: softSprite, transparent: true, opacity: 1, depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.visible = false;
    points.name = "NestSmoke";
    return { points, pool: createSmoke(SMOKE_POOL, MAX_SAUCERS) };
  }, []);

  useEffect(() => () => {
    for (const o of [bolts, jet, smoke.points]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    bolts.dispose();
  }, [bolts, jet, smoke]);

  // Per-frame scratch.
  const scratch = useMemo(() => ({
    m: new THREE.Matrix4(), c: new THREE.Color(), ship: new THREE.Color(), enemy: new THREE.Color(ENEMY_BOLT_HEX),
    thrust: new THREE.Color(THRUST_HEX), jet: new THREE.Color(JET_HEX), plume: "", p: { x: 0, y: 0, z: 0 } as V3,
    cam: { x: 0, y: 0, z: 0 } as V3,
  }), []);

  // Live counts for the renderer's debug handle (NestMonsters reads them; dev only).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    nestEffectMeshes.meshes = [bolts, jet, smoke.points];
    return () => { nestEffectMeshes.meshes = []; };
  }, [bolts, jet, smoke]);

  useFrame((state, delta) => {
    const s = useSpaceStore.getState();
    const n = combat.nest;
    const dt = nestPaused(s) ? 0 : Math.min(delta, 0.05);
    const comp = exposureCompensation.value;
    // The camera, for the sprites' near fade (nearFade).
    const cam = scratch.cam;
    cam.x = state.camera.position.x; cam.y = state.camera.position.y; cam.z = state.camera.position.z;

    // ── Bolts and thrust glows ──
    if (s.plumeColor !== scratch.plume) {
      scratch.plume = s.plumeColor;
      scratch.ship.set((PLUME_COLORS[s.plumeColor] ?? PLUME_COLORS.stock).hex);
    }
    (bolts.material as THREE.MeshBasicMaterial).color.setScalar(comp);
    let k = 0;
    const pool = n.bolts.bolts;
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i];
      if (!b.live) continue;
      const ship = b.owner === "ship";
      bolts.setMatrixAt(k, boltMatrix(b.x, b.y, b.z, b.dx, b.dy, b.dz, BOLT_GLOW_R,
        ship ? SHIP_BOLT_LENGTH : ENEMY_BOLT_LENGTH, scratch.m));
      bolts.setColorAt(k, scratch.c.copy(ship ? scratch.ship : scratch.enemy).multiplyScalar(BOLT_GLOW));
      k++;
    }
    for (let i = 0; i < n.saucers.length; i++) {
      const sc = n.saucers[i];
      if (!sc.alive) continue;
      bolts.setMatrixAt(k, thrustMatrix(sc, scratch.m));
      bolts.setColorAt(k, scratch.c.copy(scratch.thrust).multiplyScalar(THRUST_GLOW));
      k++;
    }
    bolts.count = k;
    bolts.visible = k > 0;
    if (k > 0) {
      bolts.instanceMatrix.needsUpdate = true;
      bolts.instanceColor!.needsUpdate = true;
    }

    // ── The plasma jet ──
    const jp = jet.geometry.getAttribute("position") as THREE.BufferAttribute;
    const jc = jet.geometry.getAttribute("color") as THREE.BufferAttribute;
    const jpa = jp.array as Float32Array, jca = jc.array as Float32Array;
    let j = 0;
    for (let i = 0; i < n.tardigrades.length; i++) {
      const t = n.tardigrades[i];
      if (!t.alive || t.phase !== "jet") continue;
      const l = Math.hypot(t.jdx, t.jdy, t.jdz) || 1;
      for (let q = 0; q < JET_PARTICLES; q++, j++) {
        const p = jetParticle(q, JET_PARTICLES, t.phaseT, t.jx, t.jy, t.jz, t.jdx, t.jdy, t.jdz, scratch.p);
        jpa[j * 3] = p.x; jpa[j * 3 + 1] = p.y; jpa[j * 3 + 2] = p.z;
        // Fades toward the far end.
        const along = ((p.x - t.jx) * t.jdx + (p.y - t.jy) * t.jdy + (p.z - t.jz) * t.jdz) / l;
        // Faded out near the camera: additive black draws nothing.
        const g = JET_GLOW * comp * (1 - (1 - JET_FAR) * Math.min(1, Math.max(0, along / JET_RANGE)))
          * nearFade(p.x, p.y, p.z, cam);
        jca[j * 3] = scratch.jet.r * g; jca[j * 3 + 1] = scratch.jet.g * g; jca[j * 3 + 2] = scratch.jet.b * g;
      }
    }
    jet.geometry.setDrawRange(0, j);
    jet.visible = j > 0;
    if (j > 0) { jp.needsUpdate = true; jc.needsUpdate = true; }

    // ── Smoke ──
    stepSmoke(smoke.pool, n.saucers, dt, Math.random);
    const sp = smoke.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const scol = smoke.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    const spa = sp.array as Float32Array, sca = scol.array as Float32Array;
    let m = 0;
    const puffs = smoke.pool.puffs;
    for (let i = 0; i < puffs.length; i++) {
      const f = puffs[i];
      if (!f.live) continue;
      spa[m * 3] = f.x; spa[m * 3 + 1] = f.y; spa[m * 3 + 2] = f.z;
      sca[m * 4] = SMOKE_GREY[0] * comp; sca[m * 4 + 1] = SMOKE_GREY[1] * comp; sca[m * 4 + 2] = SMOKE_GREY[2] * comp;
      sca[m * 4 + 3] = smokeAlpha(f.age) * nearFade(f.x, f.y, f.z, cam);
      m++;
    }
    smoke.points.geometry.setDrawRange(0, m);
    smoke.points.visible = m > 0;
    if (m > 0) { sp.needsUpdate = true; scol.needsUpdate = true; }
  });

  return (
    <>
      <primitive object={bolts} />
      <primitive object={jet} />
      <primitive object={smoke.points} />
    </>
  );
}
