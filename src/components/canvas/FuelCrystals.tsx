import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { flight, useSpaceStore, bodies, crystalSlots } from "../../store/spaceStore";
import { planets, PORTAL_POS, COSMIC_BOUNDS } from "../../constants";
import { toroidalDistance3 } from "../../utils/toroidal";
import { ambientTime } from "../../utils/ambientTime";
import { refuel, refuelOutcome, FUEL_MAX } from "../../utils/fuel";
import {
  CRYSTAL_MAX, CRYSTAL_PICKUP_RADIUS, randomCrystalPos, respawnTick,
  type AvoidPoint,
} from "../../utils/crystalField";
import { soundManager } from "../../audio/soundManager";
import { fitzDebug } from "../../debug/bridge";
import { assetUrl } from "../../utils/assetUrl";

const dummy = new THREE.Object3D();
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);

/**
 * Floating fuel crystals. One InstancedMesh of CRYSTAL_MAX fixed slots —
 * inactive slots scale to zero rather than resizing any array, exactly as
 * DataShards handles collected shards. No React state, so a pickup costs no
 * render: the matrices and `flight.fuel` carry all of it.
 */
export default function FuelCrystals() {
  const { scene } = useGLTF(assetUrl("/models/space_crystal.glb"));
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const respawnAccum = useRef(0);

  // Reuse the GLB's first mesh, baked to world scale — same approach as
  // AsteroidBelt takes with asteroids.glb.
  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((c) => { if (!src && c instanceof THREE.Mesh) src = c; });
    if (!src) throw new Error("space_crystal.glb contains no mesh");
    src.updateMatrix();
    const g = src.geometry.clone();
    g.applyMatrix4(src.matrix);
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    m.emissive = new THREE.Color("#ffd24a");
    m.emissiveIntensity = 1.8;
    return { geometry: g, material: m };
  }, [scene]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  /** Places to keep clear of, rebuilt per spawn from live positions. */
  const avoidFor = (): AvoidPoint[] => [
    ...planets.map((p) => ({ ...bodies[p.name], r: 20 })),
    { x: PORTAL_POS[0], y: PORTAL_POS[1], z: PORTAL_POS[2], r: 20 },
    // Keep clear of the ship so crystals never pop into view.
    { x: flight.x, y: flight.y, z: flight.z, r: 30 },
  ];

  // Seed the shared slot array once. `crystalSlots` is module-level state in
  // spaceStore, the same pattern as `flight` and `bodies` — so the radar can read
  // it in production, which a bridge-only channel could not.
  const slots = crystalSlots;
  useEffect(() => {
    if (slots.length > 0) return; // already seeded (StrictMode double-mount)
    for (let i = 0; i < CRYSTAL_MAX; i++) {
      const [x, y, z] = randomCrystalPos(Math.random, avoidFor());
      slots.push({ x, y, z, active: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror onto the bridge purely so the e2e probe can read it. The radar does
  // NOT use this path — it imports crystalSlots directly.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.crystals = slots;
    return () => { fitzDebug.crystals = null; };
  }, [slots]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dt = Math.min(delta, 0.05);
    const t = ambientTime(state.clock.getElapsedTime());
    const store = useSpaceStore.getState();

    // Refill empty slots on a timer while below the cap.
    const tick = respawnTick(respawnAccum.current, dt);
    respawnAccum.current = tick.accum;
    for (let n = 0; n < tick.spawns; n++) {
      const slot = slots.find((s) => !s.active);
      if (!slot) break; // at cap — nothing to do
      const [x, y, z] = randomCrystalPos(Math.random, avoidFor());
      slot.x = x; slot.y = y; slot.z = z; slot.active = true;
    }

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.active) {
        dummy.position.set(0, 0, 0);
        dummy.scale.copy(ZERO_SCALE);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // Bob and spin are decorative and read ambientTime, so they freeze under
      // reduced motion. Per-slot rate/phase from the index so a cluster does not
      // move as one rigid body.
      const bob = Math.sin(t * (1.0 + (i % 5) * 0.17) + i) * 0.9;
      dummy.position.set(s.x, s.y + bob, s.z);
      dummy.rotation.set(Math.sin(t * 0.3 + i) * 0.4, t * (0.5 + (i % 4) * 0.15) + i, 0);
      dummy.scale.setScalar(0.6);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Pickup measures the BASE position, never `s.y + bob`. That is what makes
      // freezing the bob under reduced motion unable to affect collection.
      const dist = toroidalDistance3(flight.x, flight.z, flight.y, s.x, s.z, s.y, COSMIC_BOUNDS);
      if (dist < CRYSTAL_PICKUP_RADIUS) {
        // Consume it even at a full tank, or a full ship would plough through a
        // crystal field leaving it visibly intact.
        const before = flight.fuel;
        flight.fuel = refuel(flight.fuel);
        s.active = false;
        soundManager.pickup();
        // Clear the DRY flag here as well as in Spaceship's loop. Spaceship's
        // `setFuelEmpty` call sits below its photo-mode and orbit-lock early
        // returns, so while the ship is orbit-locked nothing reconciles the flag —
        // a pickup in that state would refuel the tank while the HUD still read
        // OFFLINE (NO FUEL) until the visitor broke orbit. A pickup is a discrete
        // event, not a per-frame one, and the setter is change-guarded, so calling
        // it here costs nothing in the steady state.
        store.setFuelEmpty(flight.fuel <= 0);
        // Confirm only the pickup that changes the visitor's situation. A
        // healthy-tank top-up stays silent because typeLine interrupts, and a
        // line per pickup would stomp the ticker across a crystal field.
        // Percentage uses the gauge's own expression, clamp included
        // (HUDOverlay.tsx:56,66), so the number in the line always matches
        // the number on the bar.
        const pctText = (Math.max(0, Math.min(1, flight.fuel / FUEL_MAX)) * 100).toFixed(0);
        const outcome = refuelOutcome(before);
        switch (outcome) {
          case "vented":
            store.sendBroadcast("FUEL CRYSTAL VENTED // TANK ALREADY FULL");
            break;
          case "restored":
            store.sendBroadcast(`WARP CORE RECHARGED // ${pctText}% — WARP ONLINE`);
            break;
          case "topped-up":
            store.sendBroadcast(`FUEL CRYSTAL ABSORBED // ${pctText}%`);
            break;
          case "quiet":
            break;
          default: {
            // Exhaustiveness guard: a fifth RefuelOutcome member should fail
            // to compile here rather than silently broadcast nothing.
            const _exhaustive: never = outcome;
            void _exhaustive;
          }
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh name="FuelCrystals" ref={meshRef}
      args={[geometry, material, CRYSTAL_MAX]} frustumCulled={false} />
  );
}
