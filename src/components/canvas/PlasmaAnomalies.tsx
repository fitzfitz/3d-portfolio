import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useModel } from "../../utils/sceneAssets";
import { flight } from "../../store/spaceStore";
import { SYSTEM_RADIUS } from "../../constants";
import { assetUrl } from "../../utils/assetUrl";
import { gameTime } from "../../utils/ambientTime";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { fitzDebug } from "../../debug/bridge";

/** Fixed pool size. Slots are preallocated at load and recycled forever. */
const ANOMALY_MAX = 40;

/**
 * Box anomalies bounce inside (spec §5): the whole play volume. It used to be
 * ±60 around the origin, but clicks spawn up to ~90u from the ship anywhere in
 * the system, so an anomaly spawned outside that box snapped to its wall on
 * the next frame and was never seen.
 */
const ANOMALY_LIMIT = SYSTEM_RADIUS;

interface Anomaly {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Index into COLORS; written to the instance colour buffer on spawn. */
  colorIdx: number;
  active: boolean;
  /** Rotation phase, so a cluster of spawns does not tumble in lockstep. */
  phase: number;
}

/**
 * Matches the old per-anomaly material's `emissiveIntensity` (3.6). There is
 * no `emissive` uniform any more (see the material-choice comment on the
 * component below), so the same brightness is baked directly into the
 * instance colour instead -- `toneMapped={false}` lets it stay above 1.0
 * rather than being clamped, which is what makes it clear Bloom's
 * `luminanceThreshold` of 0.2.
 */
const PLASMA_GLOW = 3.6;

const COLORS = ["#00f0ff", "#bd00ff", "#ec4899", "#00ff87"]
  .map((c) => new THREE.Color(c).multiplyScalar(PLASMA_GLOW));

/** Scratch objects, reused every frame so the loop allocates nothing. */
const shipPos = new THREE.Vector3();
const pullDir = new THREE.Vector3();
const dummy = new THREE.Object3D();
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);

/**
 * Advances every active anomaly in place. Deactivates absorbed ones.
 *
 * Returns nothing and touches no React state: absorption used to trigger a
 * setState, which meant a canvas commit mid-flight. A slot going inactive is
 * now expressed purely as a zero-scale matrix.
 */
function stepAnomalies(pool: Anomaly[], ship: THREE.Vector3, dt: number): void {
  // Velocities and drag are tuned per 60fps frame; scale them by elapsed
  // frames so a 120Hz display doesn't run the simulation at double speed.
  const frames = Math.min(dt, 0.05) * 60;
  const drag = Math.pow(0.985, frames);
  for (const m of pool) {
    if (!m.active) continue;
    const dist = m.position.distanceTo(ship);

    if (dist < 0.4) {
      m.active = false;
      continue;
    }

    // Magnetic suction toward the ship, strengthening as it closes.
    if (dist < 4.5) {
      pullDir.subVectors(ship, m.position).normalize();
      m.velocity.addScaledVector(pullDir, (1.0 - dist / 4.5) * 0.003 * frames);
    }

    m.position.addScaledVector(m.velocity, frames);
    m.velocity.multiplyScalar(drag);

    // Boundary reflection off the system sphere.
    const pr = m.position.length();
    if (pr >= ANOMALY_LIMIT) {
      m.position.multiplyScalar(ANOMALY_LIMIT / pr);
      // Reflect the outward velocity component (nx = position / R), damped.
      const nx = m.position.x / ANOMALY_LIMIT, ny = m.position.y / ANOMALY_LIMIT, nz = m.position.z / ANOMALY_LIMIT;
      const vn = m.velocity.x * nx + m.velocity.y * ny + m.velocity.z * nz;
      if (vn > 0) {
        const k = vn * 1.8;
        m.velocity.x -= nx * k; m.velocity.y -= ny * k; m.velocity.z -= nz * k;
      }
    }
  }
}

export interface AnomaliesRef {
  spawn: (point: THREE.Vector3) => void;
}

/**
 * Click-spawned plasma anomalies, as a preallocated InstancedMesh pool --
 * the same shape FuelCrystals and DataShards use.
 *
 * The previous version mounted a <pointLight> per anomaly. Three.js bakes the
 * light count into every shader's program cache key, so each spawn forced a
 * synchronous scene-wide shader recompile: the visible click stall. It also
 * cloned the GLTF scene and its materials per anomaly, producing 40 unique
 * materials and 40+ draw calls with no batching.
 *
 * Now: one geometry, one shared unlit material, one draw call, per-instance
 * colour, and nothing whatsoever allocated at click time. The glow comes from
 * the Bloom pass, which runs at luminanceThreshold 0.2.
 *
 * MeshBasicMaterial, not MeshStandardMaterial: a first pass followed
 * FuelCrystals's pattern of an emissive MeshStandardMaterial tinted per
 * instance via `setColorAt`, and every anomaly rendered the same flat white
 * regardless of its assigned colour. Verified against the three.js source:
 * `color_fragment` multiplies instance colour into `diffuseColor` only
 * (gated on `USE_COLOR`), while the physical shader's `totalEmissiveRadiance`
 * is set solely from the material's own `emissive` uniform
 * (meshphysical.glsl.js) and is never touched by instance colour. Bloom is
 * driven by the emissive term, so the tint never reached it.
 * MeshBasicMaterial has no lighting response to wash the tint back out --
 * `diffuseColor`, driven directly by instance colour, IS the fragment output
 * -- so PLASMA_GLOW's brightness and the palette colours both survive to
 * the screen untouched.
 */
export const PlasmaAnomalies = forwardRef<AnomaliesRef>((_props, ref) => {
  const { scene } = useModel(assetUrl("/models/space_crystal.glb"));
  const meshRef = useRef<THREE.InstancedMesh>(null);
  /** Round-robin cursor, advanced only when a spawn must evict a live slot. */
  const nextSlot = useRef(0);

  // Reuse the GLB's first mesh, baked to world scale -- same approach as
  // FuelCrystals takes with the identical model. Only the geometry survives
  // the source mesh -- see the material-choice comment on the component.
  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((c) => { if (!src && c instanceof THREE.Mesh) src = c; });
    if (!src) throw new Error("space_crystal.glb contains no mesh");
    // Float-safe: the quantized GLB stores positions in [-1, 1] (see util).
    const g = bakeNodeTransform(src);
    const m = new THREE.MeshBasicMaterial({ toneMapped: false });
    return { geometry: g, material: m };
  }, [scene]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  /** The pool. Allocated once, never resized. */
  const pool = useMemo<Anomaly[]>(() =>
    Array.from({ length: ANOMALY_MAX }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      colorIdx: 0,
      active: false,
      phase: 0,
    })), []);

  // Mirror onto the bridge purely so the e2e probe can read it, the same
  // pattern FuelCrystals.tsx uses for `crystals`. Without this, a spawn
  // regression is invisible to transition.probe.mjs's 40-spawns section: the
  // InstancedMesh mounts with a fixed `count = ANOMALY_MAX` regardless of how
  // many slots are actually active, so draw calls/triangles never move and
  // every assertion there passes vacuously whether spawning works or not.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.anomalies = pool;
    return () => { fitzDebug.anomalies = null; };
  }, [pool]);

  // Create and seed the instance colour buffer once, at mount, even though
  // every value written here is immediately overwritten per-slot at spawn.
  // This is NOT redundant: `InstancedMesh.setColorAt` lazily creates
  // `mesh.instanceColor` on its first call, and three.js's program cache key
  // includes `object.instanceColor !== null`
  // (WebGLPrograms.js: `instancingColor`), recomputed fresh on every render.
  // If that first call happened at click time instead of here, the very
  // first spawn would flip the cache key and force a one-time synchronous
  // recompile -- reintroducing, for one click, the exact stall this
  // component exists to remove. Doing it here, long before any click is
  // possible, means the buffer already exists and `before`/`after` in
  // tests/e2e/transition.probe.mjs see the same program count.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < ANOMALY_MAX; i++) mesh.setColorAt(i, COLORS[i % COLORS.length]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useImperativeHandle(ref, () => ({
    spawn(point: THREE.Vector3) {
      // Prefer a genuinely free slot; only recycle the oldest *live* one once
      // all 40 are active. An earlier version recycled round-robin purely by
      // spawn count, so it could evict a slot that was still flying while
      // dead slots sat unused -- visibly teleporting an anomaly away
      // mid-flight. `pool.findIndex` mirrors FuelCrystals.tsx's
      // `slots.find((s) => !s.active)`. No allocation, no state, no render.
      let i = pool.findIndex((m) => !m.active);
      if (i === -1) {
        i = nextSlot.current;
        nextSlot.current = (nextSlot.current + 1) % ANOMALY_MAX;
      }
      const m = pool[i];
      m.position.set(point.x, point.y + (Math.random() - 0.5) * 0.5, point.z);
      // Clamp inside the sphere at spawn, not only by the per-frame reflect: a
      // click past the edge must not flash a frame outside it.
      const pr = m.position.length();
      if (pr > ANOMALY_LIMIT) m.position.multiplyScalar(ANOMALY_LIMIT / pr);
      m.velocity.set(
        (Math.random() - 0.5) * 0.015,
        (Math.random() - 0.5) * 0.005,
        (Math.random() - 0.5) * 0.015,
      );
      m.phase = Math.random() * Math.PI * 2;
      // Random per spawn, matching the old per-anomaly `colors[random]` pick
      // -- assigning by slot index instead would cycle colours
      // deterministically by pool position rather than by spawn. The buffer
      // itself already exists (see the mount effect above), so this write is
      // just a value update, not the one that would risk a recompile.
      m.colorIdx = Math.floor(Math.random() * COLORS.length);
      m.active = true;

      const mesh = meshRef.current;
      if (mesh) {
        mesh.setColorAt(i, COLORS[m.colorIdx]);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
  }), [pool]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    shipPos.set(flight.x, flight.y, flight.z);
    stepAnomalies(pool, shipPos, delta);

    // Rotation stays on gameTime rather than ambientTime: anomalies are
    // spawned by clicking, so they are user-initiated and the reduced-motion
    // spec deliberately exempts them. gameTime (unlike a raw clock read)
    // still carries forward across a THREE.Clock reset (Task 6's dossier
    // freeze), which is what keeps this rotation from phase-popping the
    // instant a modal opens or closes — see utils/ambientTime.ts.
    const t = gameTime(state.clock.getElapsedTime());
    for (let i = 0; i < ANOMALY_MAX; i++) {
      const m = pool[i];
      if (!m.active) {
        dummy.position.set(0, 0, 0);
        dummy.scale.copy(ZERO_SCALE);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      dummy.position.copy(m.position);
      dummy.rotation.set(
        0.15 + Math.sin(t * 0.7 + m.phase) * 0.25,
        t * 1.4 + m.phase,
        Math.cos(t * 0.5 + m.phase * 1.7) * 0.2,
      );
      dummy.scale.setScalar(0.55);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh name="PlasmaAnomalies" ref={meshRef}
      args={[geometry, material, ANOMALY_MAX]} frustumCulled={false} />
  );
});

PlasmaAnomalies.displayName = "PlasmaAnomalies";
