import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useModel } from "../../utils/sceneAssets";
import * as THREE from "three";
import { PROBES, PROBE_IN_RANGE, PROBE_OPEN_DIST, PROBE_PULL_SPEED } from "../../data/probes";
import { probePos, probeRelocating } from "../../store/probeState";
import { beamState } from "../../store/beamState";
import { flight, selectModalOpen, useSpaceStore } from "../../store/spaceStore";
import { projectById } from "../../constants";
import { BEAM_MAX_TARGETS, pullStep } from "../../utils/tractorBeam";
import { tetherCount } from "../../utils/mining";
import {
  ARRIVE_S, PROBE_DRIFT_SPEED, arrivalScale, beaconLevel, burnDirection, burnFlare, burnPlume, nearestProbe, probeTip, rcsPuff,
  relocationDone, relocationLine, relocationScale, relocationTravel, spotPos, trimTone,
} from "../../utils/probes";
import { makePlumeGeometry, makePlumeMaterial, plumeSpreadFor, PLUME_HALF_ANGLE_DEG } from "./enginePlume";
import { softSprite } from "./softSprite";
import { TOKSVIG_FRAGMENT } from "./toksvig";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { fitzDebug } from "../../debug/bridge";

const N = PROBES.length;
/** Idle spin about the vertical (rad/s); frozen under reduced motion through ambientTime. */
const SPIN = 0.15;
/** Beacon lamp emissive gain at the top of its blink; the glow is Bloom's. */
const BEACON_GAIN = 3.0;
/** RCS throat glow: a puff peaks at 1, the relocation burn holds BURN_GLOW. */
const BURN_GLOW = 6.0;
/** Seconds the probe takes to swing its dish onto the burn line (the thrusters then face back at the ship). */
const BURN_TURN_S = 0.4;

const dummy = new THREE.Object3D();
const ZERO = { x: 0, y: 0, z: 0 };
const nose = { x: 0, y: 0, z: 0 };
const home = { x: 0, y: 0, z: 0 };
const burnDir = { x: 0, y: 0, z: 0 };
const trim = { r: 0, g: 0, b: 0 };
const qIdle = new THREE.Quaternion();
const qBurn = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _v = new THREE.Vector3();
/** The model's dish boresight (gen_probe.py contract). */
const BORESIGHT = new THREE.Vector3(0, 0, 1);
/**
 * Relocation plume (spec §4.2 "a visible animated burn ... plume puff"): the
 * engine plume's own shader and settings (enginePlume.ts), so it shares the
 * ship plume's compiled program, warm-tinted through uColor. One tube per
 * probe, drawn only while that probe burns (no draw call otherwise), out of
 * the main engine bell along the model's -Z. It leaves the bell's exit plane
 * at the bell's own radius (gen_probe.py ENG_EXIT: glTF z -0.399, r 0.076),
 * so the bell shows at the plume's root, its throat lit by the B zone, as a
 * real engine does; a wider tube from inside the bell drew over it.
 */
const PLUME_NOZZLE_R = 0.076;
const PLUME_AFT_Z = -0.40;
/** Full plume length (u) at burnPlume 1; about twice the model's length. */
const PLUME_LEN = 5;
/** World length (u, at full scale) over which the plume fades in from the bell's exit (enginePlume.ts uRoot). */
const PLUME_ROOT = 0.3;
/**
 * uPower at burnPlume 1. The narrower root fans out over more of its own
 * radius (enginePlume.ts thins the exhaust by the widening), so it starts
 * hotter to keep the plume's far end as bright as the 0.22 tube's was.
 */
const PLUME_POWER = 5.5;
/**
 * The nozzle flare: one soft sprite per probe (softSprite, the ship sparks'
 * exact PointsMaterial settings, so their program), so the burn still reads
 * as a hot point once the probe is a few pixels across. It fades in with the
 * camera's distance (burnFlare): up close it hid the bell.
 */
const FLARE_SIZE = 1.8;
const PLUME_WARM = new THREE.Color(1.0, 0.55, 0.18);
/** Turns the plume tube's +Y (nozzle end) onto the probe's +Z, so it streams out along -Z. */
const qPlumeTube = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

interface Burn { t: number; sx: number; sy: number; sz: number; dx: number; dy: number; dz: number }

/**
 * The shader patch (spec §4.1, controller ruling R10). The GLB's COLOR_0 is a
 * zone mask, not a colour: R = trim stripe, G = beacon lamp, B = RCS nozzle
 * throats. GLTFLoader would switch `vertexColors` on and multiply the albedo
 * by it (everything outside R/G went black), so the attribute is renamed to
 * `probeMask` and read here instead. Per instance: `probeTint` (the project
 * colour, linear), `probeTrim` (that colour through trimTone: pulled 60%
 * toward its own luminance, as the model preview does) and `probeGlow`
 * (x = beacon level, y = RCS level).
 *  - R: albedo times the trim colour, so it reads as paint. No emissive.
 *  - G: emissive tint times the beacon level (the only lamp).
 *  - B: a warm emissive flash for the RCS puff and the relocation burn.
 * And Toksvig (toksvig.ts): the mipped normal map's shortened normals widen
 * the gloss, so the MLI crinkle stays a spread of glints at range instead of
 * one flat mirror of the black sky.
 * One material and one InstancedMesh, compiled at load by ShaderWarmup.
 */
function patchProbeMaterial(m: THREE.MeshStandardMaterial): void {
  m.vertexColors = false;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec3 probeMask;
attribute vec3 probeTint;
attribute vec3 probeTrim;
attribute vec2 probeGlow;
varying vec3 vProbeMask;
varying vec3 vProbeTint;
varying vec3 vProbeTrim;
varying vec2 vProbeGlow;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vProbeMask = probeMask;
vProbeTint = probeTint;
vProbeTrim = probeTrim;
vProbeGlow = probeGlow;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vProbeMask;
varying vec3 vProbeTint;
varying vec3 vProbeTrim;
varying vec2 vProbeGlow;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
diffuseColor.rgb *= mix(vec3(1.0), vProbeTrim, vProbeMask.r);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
totalEmissiveRadiance += vProbeMask.g * vProbeTint * (vProbeGlow.x * ${BEACON_GAIN.toFixed(3)});
totalEmissiveRadiance += vProbeMask.b * vec3(1.0, 0.82, 0.55) * vProbeGlow.y;`)
      .replace("#include <lights_physical_fragment>", `${TOKSVIG_FRAGMENT}
#include <lights_physical_fragment>`);
  };
  m.customProgramCacheKey = () => "projectProbe:v3";
}

/**
 * The three project probes (spec §4.1-§4.3): one InstancedMesh, always
 * mounted. Each frame it pulls the beam's selected probe toward the nose and
 * opens its dossier at PROBE_OPEN_DIST, drifts a released probe back to its
 * spot, plays the relocation burn after a probe-origin close, writes
 * `probePos` (which the keys, pad, waypoint, radar and HUD read), sets
 * `probeNear` for the HUD tip and chatter, and blinks the beacons. Probes hold
 * station (UNIVERSE-RULES L16), so the only idle motion is a slow spin and an
 * RCS puff. Allocates nothing per frame.
 */
export default function ProjectProbes() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { scene } = useModel(assetUrl("/models/probe.glb"));

  const { geometry, material, glow } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((o) => { if (!src && o instanceof THREE.Mesh) src = o; });
    if (!src) throw new Error("probe.glb contains no mesh");
    // Not centred: the model pivots on its dish axis by contract.
    const g = bakeNodeTransform(src);
    const mask = g.getAttribute("color");
    if (!mask) throw new Error("probe.glb has no COLOR_0 zone mask");
    g.deleteAttribute("color");
    g.setAttribute("probeMask", mask);
    const tint = new Float32Array(N * 3), paint = new Float32Array(N * 3);
    const c = new THREE.Color();
    PROBES.forEach((def, i) => {
      c.set(projectById(def.id)?.color ?? "#ffffff");
      tint[i * 3] = c.r; tint[i * 3 + 1] = c.g; tint[i * 3 + 2] = c.b;
      trimTone(c.r, c.g, c.b, trim);
      paint[i * 3] = trim.r; paint[i * 3 + 1] = trim.g; paint[i * 3 + 2] = trim.b;
    });
    g.setAttribute("probeTint", new THREE.InstancedBufferAttribute(tint, 3));
    g.setAttribute("probeTrim", new THREE.InstancedBufferAttribute(paint, 3));
    const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    glowAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("probeGlow", glowAttr);
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    patchProbeMaterial(m);
    return { geometry: g, material: m, glow: glowAttr };
  }, [scene]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const plumeGeometry = useMemo(() => makePlumeGeometry(PLUME_NOZZLE_R), []);
  const plumeMaterials = useMemo(() => PROBES.map((_, i) => makePlumeMaterial(5.3 + i * 1.9, PLUME_WARM)), []);
  useEffect(() => () => { plumeGeometry.dispose(); plumeMaterials.forEach((m) => m.dispose()); }, [plumeGeometry, plumeMaterials]);
  const plumeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const flareRef = useRef<THREE.Points>(null);
  const flareGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
    const col = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage); col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pos);
    g.setAttribute("color", col);
    return g;
  }, []);
  useEffect(() => () => flareGeometry.dispose(), [flareGeometry]);

  // Per-probe frame state. Refs, not module state: a remount (classic résumé
  // round trip) snaps every probe home to its spot below and starts clean.
  const burns = useRef<Burn[]>(PROBES.map(() => ({ t: 0, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0 })));
  const held = useRef<boolean[]>(PROBES.map(() => false));
  const opened = useRef<boolean[]>(PROBES.map(() => false));
  /** Seconds since each probe last snapped to a new spot (it grows back in over ARRIVE_S). */
  const arrived = useRef<number[]>(PROBES.map(() => ARRIVE_S));
  const lastSeq = useRef(useSpaceStore.getState().relocation?.seq ?? 0);

  useEffect(() => {
    const spots = useSpaceStore.getState().probeSpots;
    for (const def of PROBES) {
      const [x, y, z] = spotPos(def, spots[def.id] ?? 0);
      const p = probePos[def.id];
      p.x = x; p.y = y; p.z = z;
      probeRelocating[def.id] = false;
    }
    arrived.current.fill(ARRIVE_S);
    lastSeq.current = useSpaceStore.getState().relocation?.seq ?? 0;
  }, []);

  // Unmounted (the classic résumé), no probe is near: the HUD tip and the
  // chatter must not hold a stale one.
  useEffect(() => () => {
    const st = useSpaceStore.getState();
    st.setProbeNear(null);
    st.setProbeTip(null);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.probes = probePos;
    return () => { fitzDebug.probes = null; };
  }, []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dt = Math.min(delta, 0.05);
    const t = ambientTime(state.clock.getElapsedTime());
    const cam = state.camera.position;
    const s = useSpaceStore.getState();
    // Photo mode can run frames under an open dossier: nothing moves then.
    const moving = !s.photoMode;

    // A probe-origin close: start that probe's burn, away from the ship but
    // swung well off the view line (burnDirection), so it streaks off.
    const reloc = s.relocation;
    if (reloc && reloc.seq !== lastSeq.current) {
      lastSeq.current = reloc.seq;
      const i = PROBES.findIndex((d) => d.id === reloc.id);
      if (i >= 0) {
        const p = probePos[reloc.id], b = burns.current[i];
        let ax = p.x - flight.x, ay = p.y - flight.y, az = p.z - flight.z;
        if (Math.hypot(ax, ay, az) < 1e-3) { ax = beamState.dx; ay = beamState.dy; az = beamState.dz; }
        burnDirection(ax, ay, az, i, burnDir);
        b.t = 0; b.sx = p.x; b.sy = p.y; b.sz = p.z;
        b.dx = burnDir.x; b.dy = burnDir.y; b.dz = burnDir.z;
        probeRelocating[reloc.id] = true;
        held.current[i] = false;
        opened.current[i] = false;
      }
    }

    // Beam: which probe is tethered this frame (TractorBeam ran first).
    for (let i = 0; i < N; i++) held.current[i] = false;
    const sel = beamState.sel;
    for (let k = 0; k < sel.count; k++) {
      if (sel.kind[k] === "probe" && sel.index[k] >= 0 && sel.index[k] < N) held.current[sel.index[k]] = true;
    }
    nose.x = beamState.ox; nose.y = beamState.oy; nose.z = beamState.oz;
    const canOpen = moving && !selectModalOpen(s);

    for (let i = 0; i < N; i++) {
      const def = PROBES[i], id = def.id, p = probePos[id];
      if (probeRelocating[id]) {
        const b = burns.current[i];
        if (moving) b.t += dt;
        if (relocationDone(b.t, s.reducedMotion)) {
          const [x, y, z] = spotPos(def, s.probeSpots[id] ?? 0);
          p.x = x; p.y = y; p.z = z;
          probeRelocating[id] = false;
          arrived.current[i] = 0;
          const title = (projectById(id)?.title ?? id).toUpperCase();
          s.sendBroadcast(relocationLine(title, x - flight.x, z - flight.z, Math.hypot(x - flight.x, y - flight.y, z - flight.z), flight.heading));
        } else {
          const d = relocationTravel(b.t);
          p.x = b.sx + b.dx * d; p.y = b.sy + b.dy * d; p.z = b.sz + b.dz * d;
        }
        continue;
      }
      if (!moving) continue;
      if (arrived.current[i] < ARRIVE_S) arrived.current[i] += dt;
      if (held.current[i]) {
        // The latch holds until the probe is released or its burn starts.
        if (canOpen) {
          const left = pullStep(p, nose, beamState.vel, PROBE_PULL_SPEED, dt);
          if (left <= PROBE_OPEN_DIST && !opened.current[i]) {
            opened.current[i] = true;
            s.openProjectDossier(id, "probe");
          }
        }
        continue;
      }
      opened.current[i] = false;
      // Released mid-pull: it stays put, then drifts back to its spot.
      const [hx, hy, hz] = spotPos(def, s.probeSpots[id] ?? 0);
      if (p.x !== hx || p.y !== hy || p.z !== hz) {
        home.x = hx; home.y = hy; home.z = hz;
        if (pullStep(p, home, ZERO, PROBE_DRIFT_SPEED, dt) < 1e-4) { p.x = hx; p.y = hy; p.z = hz; }
      }
    }

    // Matrices and glow.
    const ga = glow.array as Float32Array;
    const fp = flareGeometry.attributes.position.array as Float32Array;
    const fc = flareGeometry.attributes.color.array as Float32Array;
    let flaring = false;
    for (let i = 0; i < N; i++) {
      const id = PROBES[i].id, p = probePos[id];
      dummy.position.set(p.x, p.y, p.z);
      _euler.set(0.22 * Math.sin(i * 2.1), t * SPIN + i * 2.1, 0.18 * Math.cos(i * 1.7));
      qIdle.setFromEuler(_euler);
      const plume = plumeRefs.current[i];
      let scale = 1, level = 0;
      if (probeRelocating[id]) {
        // Burning: the dish swings onto the burn line, so the aft thrusters
        // (the lit B zone) and the plume face back toward the ship and the
        // camera; the probe dwindles out just before the snap.
        const b = burns.current[i];
        qBurn.setFromUnitVectors(BORESIGHT, _v.set(b.dx, b.dy, b.dz));
        const k = Math.min(b.t / BURN_TURN_S, 1);
        dummy.quaternion.slerpQuaternions(qIdle, qBurn, k * k * (3 - 2 * k));
        scale = relocationScale(b.t);
        level = burnPlume(b.t);
      } else {
        dummy.quaternion.copy(qIdle);
        scale = arrivalScale(arrived.current[i], s.reducedMotion);
      }
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (plume) {
        plume.visible = level > 1e-3;
        if (plume.visible) {
          // From the bell's exit plane; the tube's centre half a length further back.
          const len = PLUME_LEN * level * scale;
          _v.set(0, 0, PLUME_AFT_Z * scale - len / 2).applyQuaternion(dummy.quaternion);
          plume.position.set(p.x + _v.x, p.y + _v.y, p.z + _v.z);
          plume.quaternion.multiplyQuaternions(dummy.quaternion, qPlumeTube);
          plume.scale.set(scale, len, scale);
          const u = plumeMaterials[i].uniforms;
          u.uTime.value = t;
          u.uPower.value = PLUME_POWER * level;
          u.uRoot.value = Math.min((PLUME_ROOT * scale) / Math.max(len, 1e-3), 1);
          u.uSpread.value = plumeSpreadFor(len, PLUME_NOZZLE_R * scale, PLUME_HALF_ANGLE_DEG);
        }
      }
      // Flare at the bell's exit; black (additive: nothing) when not burning,
      // and up close, where the bell and the plume carry the burn (burnFlare).
      _v.set(0, 0, PLUME_AFT_Z * scale).applyQuaternion(dummy.quaternion);
      fp[i * 3] = p.x + _v.x; fp[i * 3 + 1] = p.y + _v.y; fp[i * 3 + 2] = p.z + _v.z;
      const fl = level > 1e-3 ? level * 1.6 * burnFlare(cam.distanceTo(_v.set(fp[i * 3], fp[i * 3 + 1], fp[i * 3 + 2]))) : 0;
      fc[i * 3] = PLUME_WARM.r * fl; fc[i * 3 + 1] = PLUME_WARM.g * fl; fc[i * 3 + 2] = PLUME_WARM.b * fl;
      if (level > 1e-3) flaring = true;
      ga[i * 2] = beaconLevel(t, (i * 2 * Math.PI) / N);
      ga[i * 2 + 1] = probeRelocating[id] ? BURN_GLOW : rcsPuff(t, i * 2);
    }
    mesh.instanceMatrix.needsUpdate = true;
    glow.needsUpdate = true;
    const flare = flareRef.current;
    if (flare) {
      flare.visible = flaring;
      if (flaring) { flareGeometry.attributes.position.needsUpdate = true; flareGeometry.attributes.color.needsUpdate = true; }
    }

    // HUD tip and chatter: the nearest probe in range, and whether the beam
    // would take a probe from where it points now, with the slots tethered
    // pebbles leave (TractorBeam's budget; both setters change-guarded).
    const near = nearestProbe(flight.x, flight.y, flight.z, probePos, probeRelocating, PROBE_IN_RANGE);
    s.setProbeNear(near);
    s.setProbeTip(probeTip(beamState.ox, beamState.oy, beamState.oz, beamState.dx, beamState.dy, beamState.dz, probePos, probeRelocating, near,
      BEAM_MAX_TARGETS - tetherCount()));
  });

  return (
    <>
      <instancedMesh name="ProjectProbes" ref={meshRef} args={[geometry, material, N]} frustumCulled={false} />
      {/* Grouped, not at the scene root: sky.probe.mjs reads every root-level
          Points as a star shell that must stay centred on the ship. */}
      <group name="ProbeBurn">
        {PROBES.map((def, i) => (
          <mesh key={def.id} name="ProbeBurnPlume" ref={(m) => { plumeRefs.current[i] = m; }}
            geometry={plumeGeometry} material={plumeMaterials[i]} visible={false} frustumCulled={false} />
        ))}
        <points ref={flareRef} name="ProbeBurnFlare" geometry={flareGeometry} visible={false} frustumCulled={false}>
          {/* The ship sparks' settings (Spaceship.tsx) bar the size, a uniform: shares their program. */}
          <pointsMaterial vertexColors={true} size={FLARE_SIZE} map={softSprite} transparent={true} opacity={1}
            blending={THREE.AdditiveBlending} depthWrite={false} />
        </points>
      </group>
    </>
  );
}
