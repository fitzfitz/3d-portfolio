import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useModel } from "../../utils/sceneAssets";
import { useSpaceStore, flight, selectRaceFlying } from "../../store/spaceStore";
import { mulberry32 } from "../../utils/mulberry32";
import { makeBelt, makeTrojans, BELT_COUNT, BELT_COUNT_LOW, TROJAN_COUNT, type FieldRock } from "../../data/smallBodyField";
import { beltRockPosition } from "../../utils/beltRocks";
import { orreryJd } from "../../utils/orreryClock";
import { AU } from "../../constants";
import { decay } from "../../utils/reactions";
import {
  nearRing, stepRock, holdAt, BELT_PUSH_HALFLIFE, BELT_RETURN_HALFLIFE,
} from "../../utils/beltPush";
import { ambientTime, gameTime } from "../../utils/ambientTime";
import { registerRing, pebbleWorld, isTethered, regrowScale, stepMining, miningState, tetherPos, addOre, FirstOreLine } from "../../utils/mining";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";
import { beamState } from "../../store/beamState";
import { soundManager } from "../../audio/soundManager";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { fitzDebug } from "../../debug/bridge";
import { assetUrl } from "../../utils/assetUrl";
import { beltRockGeometry, beltRockMaterial } from "./beltRock";

/** Rock radius per unit of FieldRock.scale (scales 0.6-1.5 land on the old 0.05-0.22). */
const ROCK_SCALE = 0.14;
/** Position scratch: rocks are written in place, never allocated per frame. */
const rockPos = { x: 0, y: 0, z: 0 };
const dummy = new THREE.Object3D();
/** Tether position scratch (mining). */
const _tp = { x: 0, y: 0, z: 0 };
/** Module-level so it survives the classic-résumé remount (like HUDOverlay's dryAnnouncedThisSpell). */
const firstOreLine = new FirstOreLine();
const lastBroadcast = { id: 0, at: -Infinity };
const oreLines = new ChatterScheduler(chatterPools);

interface Spin { x: number; y: number; z: number }

interface BeltRingProps {
  geometry: THREE.BufferGeometry; material: THREE.Material;
  count: number; rocks: readonly FieldRock[];
  /** Orbit-distance band (scene units) the ring's rocks can reach, for the push early-out. */
  rMin: number; rMax: number;
  /** scene name so e2e probes can assert instance counts */
  name: string;
  /** Mining ring id (0 main belt, 1 Trojans): indexes pebble state in mining.ts. */
  ring: number;
}

function BeltRing({ geometry, material, count, rocks, rMin, rMax, name, ring }: BeltRingProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const total = rocks.length;
  // Tumble rates only: the orbits come from each rock's own elements.
  const spins = useMemo<Spin[]>(() => {
    const rand = mulberry32(total * 7919 + ring);
    // Signed Z so rocks tumble both directions rather than all one way.
    return Array.from({ length: total }, () => ({ x: 0.2 + rand() * 0.6, y: 0.2 + rand() * 0.6, z: (rand() - 0.5) * 0.9 }));
  }, [total, ring]);

  // Per-rock push displacement (spec: belt parts around the ship). Sized to
  // `total` so a low-perf count change never reallocates.
  const disp = useMemo(() => new Float32Array(total * 3), [total]);
  // Pebble world positions for mining; cleared when the ring unmounts (the
  // halo in low-perf mode) so the beam can never mine an invisible rock.
  const world = useMemo(() => { registerRing(ring, total); return pebbleWorld(ring); }, [ring, total]);
  useEffect(() => () => { world.fill(NaN); }, [world]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const t = ambientTime(state.clock.getElapsedTime());
    const dt = Math.min(delta, 0.05);
    const react = !useSpaceStore.getState().reducedMotion;
    const ship = react && nearRing(flight, rMin, rMax) ? flight : null;
    const kPush = decay(BELT_PUSH_HALFLIFE, dt);
    const kReturn = decay(BELT_RETURN_HALFLIFE, dt);
    const now = gameTime(state.clock.getElapsedTime());
    const jd = orreryJd(t);
    for (let i = 0; i < count; i++) {
      const r = rocks[i], sp = spins[i];
      beltRockPosition(r, jd, rockPos);
      const x = rockPos.x, y = rockPos.y, z = rockPos.z;
      const j = i * 3;
      // A tethered pebble is pulled by mining.ts in world space; it stops
      // following its orbit and the belt's push until absorbed or released.
      // With reduced motion `ship` is null: no push, but a released pebble
      // still eases home instead of staying where the beam let go.
      if (!isTethered(ring, i)) stepRock(disp, i, x, y, z, ship, kPush, kReturn);
      const lx = x + disp[j], ly = y + disp[j + 1], lz = z + disp[j + 2];
      // Rocks are already in world space.
      world[j] = lx; world[j + 1] = ly; world[j + 2] = lz;
      dummy.position.set(lx, ly, lz);
      dummy.rotation.set(i + t * sp.x, t * sp.y, t * sp.z);
      // 1 for a pebble never mined; 0 while absorbed, easing back once regrown.
      dummy.scale.setScalar(r.scale * ROCK_SCALE * regrowScale(ring, i, now));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    // Pebbles past the drawn count (low-perf) are not in the scene: unmineable.
    if (count < total) world.fill(NaN, count * 3);

    // Tethered pebbles draw where the beam has pulled them (world space).
    // The offset from their orbit slot goes into `disp`, so on release they
    // ease home from here rather than snapping back.
    for (let k = 0; k < miningState.tetherCount; k++) {
      const tt = miningState.tethers[k];
      if (tt.ring !== ring || tt.index >= count) continue;
      tetherPos(k, _tp);
      const rk = rocks[tt.index], sk = spins[tt.index];
      dummy.position.set(_tp.x, _tp.y, _tp.z);
      beltRockPosition(rk, jd, rockPos);
      holdAt(disp, tt.index, rockPos.x, rockPos.y, rockPos.z, _tp.x, _tp.y, _tp.z);
      dummy.rotation.set(tt.index + t * sk.x, t * sk.y, t * sk.z);
      dummy.scale.setScalar(rk.scale * ROCK_SCALE);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(tt.index, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;

    // Mining runs once per frame, from the main ring.
    if (ring === 0) {
      const absorbed = stepMining(now, dt, flight);
      if (absorbed > 0) {
        const next = addOre(flight.fuel, beamState.ore, absorbed);
        flight.fuel = next.fuel;
        beamState.ore = next.ore;
        beamState.oreAt = performance.now();
        beamState.oreStreak += absorbed;
        const store = useSpaceStore.getState();
        store.setFuelEmpty(flight.fuel <= 0);
        if (next.crystals > 0) store.recordBadge("ore"); // logbook: Prospector
        soundManager.oreTick();
      }
      // First-ore line: same busy-radio and race hold as the other pools.
      // Read the store fresh, so a badge line sent just above counts as busy.
      const radio = useSpaceStore.getState();
      const sec = performance.now() / 1000;
      const bid = radio.broadcast?.id ?? 0;
      if (bid !== lastBroadcast.id) { lastBroadcast.id = bid; lastBroadcast.at = sec; }
      if (firstOreLine.update(absorbed > 0, sec - lastBroadcast.at < RADIO_BUSY_S, selectRaceFlying(radio))) {
        radio.sendBroadcast(oreLines.pick("ore"), { silent: true });
      }
    }
  });

  return (
    <instancedMesh name={name} key={count} ref={meshRef} args={[geometry, material, count]}
      frustumCulled={false} dispose={null} />
  );
}

// Orbit-distance bands: belt a 2.1-3.3 AU, e <= 0.3; Trojans a = 5.2 AU, e < 0.15.
const BELT_R_MIN = 2.1 * 0.7 * AU, BELT_R_MAX = 3.3 * 1.3 * AU;
const TROJAN_R_MIN = 5.2 * 0.85 * AU, TROJAN_R_MAX = 5.2 * 1.15 * AU;

export default function AsteroidBelt() {
  const { scene } = useModel(assetUrl("/models/asteroids.glb"));
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.mining = miningState;
    return () => { fitzDebug.mining = null; };
  }, []);
  const count = isLowPerf ? BELT_COUNT_LOW : BELT_COUNT;
  const belt = useMemo(() => makeBelt(BELT_COUNT, 42), []);
  const trojans = useMemo(() => makeTrojans(TROJAN_COUNT, 1337), []);

  // The belt's rock (beltRock.ts): an 80-triangle stand-in in the hero Asteroid1's material, shared with the Nest's rocks.
  const { geometry, material } = useMemo(() => ({ geometry: beltRockGeometry(), material: beltRockMaterial(scene) }), [scene]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <>
      {/* Main belt: 2.1-3.3 AU, real inclinations, Kirkwood gaps */}
      <BeltRing geometry={geometry} material={material} count={count} rocks={belt}
        rMin={BELT_R_MIN} rMax={BELT_R_MAX} name="BeltMain" ring={0} />
      {/* Jupiter's Trojans: two lobes 60 degrees ahead of and behind Jupiter.
          Skipped in low-perf mode. */}
      {!isLowPerf && (
        <BeltRing geometry={geometry} material={material} count={TROJAN_COUNT} rocks={trojans}
          rMin={TROJAN_R_MIN} rMax={TROJAN_R_MAX} name="BeltHalo" ring={1} />
      )}
    </>
  );
}
