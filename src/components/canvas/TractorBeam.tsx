import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { beamState } from "../../store/beamState";
import { crystalSlots, flight, useSpaceStore } from "../../store/spaceStore";
import { SHARDS } from "../../data/shards";
import { BEAM_MAX_TARGETS, BEAM_RANGE, BEAM_HALF_ANGLE, clearSelection, consider, inCone, nearestShardInCone, nearImage } from "../../utils/tractorBeam";
import { tetherCount, tetherPos } from "../../utils/mining";
import { makeBeamGeometry, makePlumeMaterial } from "./enginePlume";
import { ambientTime } from "../../utils/ambientTime";
import { soundManager } from "../../audio/soundManager";

const BEAM_TINT = new THREE.Color("#3ff2d0");
const DOWN = new THREE.Vector3(0, -1, 0);
const _dir = new THREE.Vector3();
const _tether = { x: 0, y: 0, z: 0 };

/**
 * Writes tether line `n` (nose to target) into `arr` and returns the next index.
 * Aims at the target's nearest image, so a tether never spans the universe at the seam.
 */
function putTether(arr: Float32Array, n: number, ox: number, oy: number, oz: number, x: number, y: number, z: number): number {
  const j = n * 6;
  arr[j] = ox; arr[j + 1] = oy; arr[j + 2] = oz;
  arr[j + 3] = nearImage(ox, x); arr[j + 4] = nearImage(oy, y); arr[j + 5] = nearImage(oz, z);
  return n + 1;
}

/**
 * Tractor beam (spec §6): picks this frame's crystal and shard targets
 * (nearest first, sharing the 3-target budget with tethered pebbles), sets the
 * shard reel, and draws a soft cone plus one tether per target. The cone
 * reuses the engine plume's shader with a teal uColor, and the tethers reuse
 * the streak line material's parameters, so neither adds a shader program.
 */
export default function TractorBeam() {
  const coneRef = useRef<THREE.Mesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const wasActive = useRef(false);

  // A point at the nose widening to the beam's radius at its range (enginePlume.ts).
  const coneGeometry = useMemo(() => makeBeamGeometry(), []);
  const coneMaterial = useMemo(() => makePlumeMaterial(4.2, BEAM_TINT), []);
  const lineGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BEAM_MAX_TARGETS * 2 * 3), 3));
    return g;
  }, []);
  useEffect(() => () => { coneGeometry.dispose(); coneMaterial.dispose(); lineGeometry.dispose(); },
    [coneGeometry, coneMaterial, lineGeometry]);

  useFrame((state) => {
    const active = beamState.active;
    if (active && !wasActive.current) soundManager.beamOn();
    wasActive.current = active;
    const sel = beamState.sel;
    clearSelection(sel);
    beamState.reel.active = false;
    const cone = coneRef.current, lines = linesRef.current;
    if (!active) {
      if (cone) cone.visible = false;
      if (lines) lines.visible = false;
      return;
    }

    // Tethered pebbles hold their slots; crystals and shards share the rest.
    const budget = BEAM_MAX_TARGETS - tetherCount();
    const { ox, oy, oz, dx, dy, dz } = beamState;
    for (let i = 0; i < crystalSlots.length; i++) {
      const s = crystalSlots[i];
      if (!s.active) continue;
      const d = inCone(ox, oy, oz, dx, dy, dz, s.x, s.y, s.z, BEAM_RANGE);
      if (d >= 0) consider(sel, budget, "crystal", i, -1, d, s.x, s.y, s.z);
    }
    const collected = useSpaceStore.getState().shardsCollected;
    for (let i = 0; i < SHARDS.length; i++) {
      if (collected.includes(i)) continue;
      const [x, y, z] = SHARDS[i].pos;
      const d = inCone(ox, oy, oz, dx, dy, dz, x, y, z, BEAM_RANGE);
      if (d >= 0) consider(sel, budget, "shard", i, -1, d, x, y, z);
    }
    // Shards are anchored: reel the ship toward the nearest one in the cone.
    // Independent of the target budget, so tethered pebbles cannot starve it.
    const reelTo = nearestShardInCone(ox, oy, oz, dx, dy, dz, SHARDS, collected);
    if (reelTo >= 0) {
      const [sx, sy, sz] = SHARDS[reelTo].pos;
      // Wrap-aware: the shortest way to the shard, even across the seam.
      const rx = nearImage(flight.x, sx) - flight.x, ry = nearImage(flight.y, sy) - flight.y, rz = nearImage(flight.z, sz) - flight.z;
      const rl = Math.hypot(rx, ry, rz) || 1;
      beamState.reel.active = true;
      beamState.reel.x = rx / rl; beamState.reel.y = ry / rl; beamState.reel.z = rz / rl;
    }

    // Cone: from the nose along the beam. The tube's body spans -Y, so rotate
    // -Y onto the beam direction.
    if (cone) {
      cone.visible = true;
      cone.position.set(ox, oy, oz);
      cone.quaternion.setFromUnitVectors(DOWN, _dir.set(dx, dy, dz));
      const r = Math.tan(BEAM_HALF_ANGLE) * BEAM_RANGE;
      cone.scale.set(r, BEAM_RANGE, r);
      coneMaterial.uniforms.uTime.value = ambientTime(state.clock.getElapsedTime());
      coneMaterial.uniforms.uPower.value = 0.35;
    }

    // Tethers: nose to each crystal/shard target, then to each tethered pebble.
    if (lines) {
      const arr = lines.geometry.attributes.position.array as Float32Array;
      let n = 0;
      for (let k = 0; k < sel.count && n < BEAM_MAX_TARGETS; k++) n = putTether(arr, n, ox, oy, oz, sel.x[k], sel.y[k], sel.z[k]);
      for (let t = 0; t < tetherCount() && n < BEAM_MAX_TARGETS; t++) {
        tetherPos(t, _tether);
        n = putTether(arr, n, ox, oy, oz, _tether.x, _tether.y, _tether.z);
      }
      lines.geometry.setDrawRange(0, n * 2);
      lines.geometry.attributes.position.needsUpdate = true;
      lines.visible = n > 0;
    }
  });

  return (
    <>
      <mesh ref={coneRef} name="TractorBeamCone" geometry={coneGeometry} material={coneMaterial} visible={false} frustumCulled={false} />
      <lineSegments ref={linesRef} name="TractorBeamTethers" geometry={lineGeometry} visible={false} frustumCulled={false}>
        {/* Same parameters as the ship's streaks (Spaceship.tsx): shares their program. */}
        <lineBasicMaterial color="#3ff2d0" transparent={true} opacity={0.5}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </>
  );
}
