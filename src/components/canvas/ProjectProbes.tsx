import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { PROBES, PROBE_IN_RANGE, PROBE_OPEN_DIST, PROBE_PULL_SPEED } from "../../data/probes";
import { probePos, probeRelocating } from "../../store/probeState";
import { beamState } from "../../store/beamState";
import { flight, selectModalOpen, useSpaceStore } from "../../store/spaceStore";
import { projectById } from "../../constants";
import { pullStep } from "../../utils/tractorBeam";
import {
  PROBE_DRIFT_SPEED, beaconLevel, nearestProbe, rcsPuff, relocationDone, relocationLine, relocationTravel, spotPos,
} from "../../utils/probes";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { fitzDebug } from "../../debug/bridge";

const N = PROBES.length;
/** Idle spin about the vertical (rad/s); frozen under reduced motion through ambientTime. */
const SPIN = 0.15;
/** The painted trim: the project colour washed this far toward white (R10: paint, not light). */
const PAINT_WHITE = 0.6;
/** Beacon lamp emissive gain at the top of its blink; the glow is Bloom's. */
const BEACON_GAIN = 3.0;
/** RCS throat glow: a puff peaks at 1, the relocation burn holds BURN_GLOW. */
const BURN_GLOW = 2.2;

const dummy = new THREE.Object3D();
const ZERO = { x: 0, y: 0, z: 0 };
const nose = { x: 0, y: 0, z: 0 };
const home = { x: 0, y: 0, z: 0 };

interface Burn { t: number; sx: number; sy: number; sz: number; dx: number; dy: number; dz: number }

/**
 * The shader patch (spec §4.1, controller ruling R10). The GLB's COLOR_0 is a
 * zone mask, not a colour: R = trim stripe, G = beacon lamp, B = RCS nozzle
 * throats. GLTFLoader would switch `vertexColors` on and multiply the albedo
 * by it (everything outside R/G went black), so the attribute is renamed to
 * `probeMask` and read here instead. Per instance: `probeTint` (the project
 * colour, linear) and `probeGlow` (x = beacon level, y = RCS level).
 *  - R: albedo times the tint washed PAINT_WHITE toward white. No emissive.
 *  - G: emissive tint times the beacon level (the only lamp).
 *  - B: a warm emissive flash for the RCS puff and the relocation burn.
 * One material and one InstancedMesh, compiled at load by ShaderWarmup.
 */
function patchProbeMaterial(m: THREE.MeshStandardMaterial): void {
  m.vertexColors = false;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec3 probeMask;
attribute vec3 probeTint;
attribute vec2 probeGlow;
varying vec3 vProbeMask;
varying vec3 vProbeTint;
varying vec2 vProbeGlow;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vProbeMask = probeMask;
vProbeTint = probeTint;
vProbeGlow = probeGlow;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vProbeMask;
varying vec3 vProbeTint;
varying vec2 vProbeGlow;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
diffuseColor.rgb *= mix(vec3(1.0), mix(vProbeTint, vec3(1.0), ${PAINT_WHITE.toFixed(3)}), vProbeMask.r);`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
totalEmissiveRadiance += vProbeMask.g * vProbeTint * (vProbeGlow.x * ${BEACON_GAIN.toFixed(3)});
totalEmissiveRadiance += vProbeMask.b * vec3(1.0, 0.82, 0.55) * vProbeGlow.y;`);
  };
  m.customProgramCacheKey = () => "projectProbe:v1";
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
  const { scene } = useGLTF(assetUrl("/models/probe.glb"));

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
    const tint = new Float32Array(N * 3);
    const c = new THREE.Color();
    PROBES.forEach((def, i) => {
      c.set(projectById(def.id)?.color ?? "#ffffff");
      tint[i * 3] = c.r; tint[i * 3 + 1] = c.g; tint[i * 3 + 2] = c.b;
    });
    g.setAttribute("probeTint", new THREE.InstancedBufferAttribute(tint, 3));
    const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    glowAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("probeGlow", glowAttr);
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    patchProbeMaterial(m);
    return { geometry: g, material: m, glow: glowAttr };
  }, [scene]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  // Per-probe frame state. Refs, not module state: a remount (classic résumé
  // round trip) snaps every probe home to its spot below and starts clean.
  const burns = useRef<Burn[]>(PROBES.map(() => ({ t: 0, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0 })));
  const held = useRef<boolean[]>(PROBES.map(() => false));
  const opened = useRef<boolean[]>(PROBES.map(() => false));
  const lastSeq = useRef(useSpaceStore.getState().relocation?.seq ?? 0);

  useEffect(() => {
    const spots = useSpaceStore.getState().probeSpots;
    for (const def of PROBES) {
      const [x, y, z] = spotPos(def, spots[def.id] ?? 0);
      const p = probePos[def.id];
      p.x = x; p.y = y; p.z = z;
      probeRelocating[def.id] = false;
    }
    lastSeq.current = useSpaceStore.getState().relocation?.seq ?? 0;
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
    const s = useSpaceStore.getState();
    // Photo mode can run frames under an open dossier: nothing moves then.
    const moving = !s.photoMode;

    // A probe-origin close: start that probe's burn, pointed away from the ship.
    const reloc = s.relocation;
    if (reloc && reloc.seq !== lastSeq.current) {
      lastSeq.current = reloc.seq;
      const i = PROBES.findIndex((d) => d.id === reloc.id);
      if (i >= 0) {
        const p = probePos[reloc.id], b = burns.current[i];
        let dx = p.x - flight.x, dy = p.y - flight.y, dz = p.z - flight.z;
        let l = Math.hypot(dx, dy, dz);
        if (l < 1e-3) { dx = beamState.dx; dy = beamState.dy; dz = beamState.dz; l = Math.hypot(dx, dy, dz) || 1; }
        b.t = 0; b.sx = p.x; b.sy = p.y; b.sz = p.z;
        b.dx = dx / l; b.dy = dy / l; b.dz = dz / l;
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
          const title = (projectById(id)?.title ?? id).toUpperCase();
          s.sendBroadcast(relocationLine(title, x - flight.x, z - flight.z, Math.hypot(x - flight.x, y - flight.y, z - flight.z), flight.heading));
        } else {
          const d = relocationTravel(b.t);
          p.x = b.sx + b.dx * d; p.y = b.sy + b.dy * d; p.z = b.sz + b.dz * d;
        }
        continue;
      }
      if (!moving) continue;
      if (held.current[i] && canOpen) {
        const left = pullStep(p, nose, beamState.vel, PROBE_PULL_SPEED, dt);
        if (left <= PROBE_OPEN_DIST && !opened.current[i]) {
          opened.current[i] = true;
          s.openProjectDossier(id, "probe");
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
    for (let i = 0; i < N; i++) {
      const id = PROBES[i].id, p = probePos[id];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0.22 * Math.sin(i * 2.1), t * SPIN + i * 2.1, 0.18 * Math.cos(i * 1.7));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      ga[i * 2] = beaconLevel(t, (i * 2 * Math.PI) / N);
      ga[i * 2 + 1] = probeRelocating[id] ? BURN_GLOW : rcsPuff(t, i * 2);
    }
    mesh.instanceMatrix.needsUpdate = true;
    glow.needsUpdate = true;

    // HUD tip and chatter: the nearest probe in range (store setter is change-guarded).
    s.setProbeNear(nearestProbe(flight.x, flight.y, flight.z, probePos, probeRelocating, PROBE_IN_RANGE));
  });

  return (
    <instancedMesh name="ProjectProbes" ref={meshRef} args={[geometry, material, N]} frustumCulled={false} />
  );
}
