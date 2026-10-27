import { useRef, useMemo, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useModel } from "../../utils/sceneAssets";
import { PLAYER_SHIP_SCALE, SHIP_MAX_SPEED, SHIP_WARP_SPEED, SUN_RADIUS, SYSTEM_RADIUS } from "../../constants";
import { destinationById, escapeR } from "../../data/destinations";
import { flight, useSpaceStore, bodies, selectRaceFlying, combat } from "../../store/spaceStore";
import { markShipTeleport } from "../../store/shipTeleport";
import { NEST_TOW_POSE } from "../../data/nest";
import { beamUse } from "../../utils/combat/controls";
import { takeTowRequest } from "../../utils/combat/director";
import { padRumble } from "../../utils/padRumble";
import { shipStartPose, markShipStarted } from "../../store/flightState";
import { moonPositions } from "../../store/moonState";
import { moonReach, SOLAR_MOONS } from "../../data/solarMoons";
import { fitzDebug } from "../../debug/bridge";
import { pitchStep, noseDirection, headingToward, PITCH_MAX } from "../../utils/pitchFlight";
import { escapePosition } from "../../utils/orbitEscape";
import { PROBES, PROBE_JUMP_STANDOFF, PROBE_RADIUS } from "../../data/probes";
import { probePos, probeRelocating } from "../../store/probeState";
import { probeJumpTarget, spawnAimPoint } from "../../utils/probes";
import { applyBackdrop, applyFill, cutExposure, glowScale } from "../../utils/sunLight";
import { jumpPoint } from "../../utils/navigation";
import { resolveCollision } from "../../utils/collision";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../../data/asteroids";
import { soundManager } from "../../audio/soundManager";
import { ambientTime, gameTime } from "../../utils/ambientTime";
import { stepFuel, fuelDebug } from "../../utils/fuel";
import { edgeReturn, edgeLatch } from "../../utils/edgeHaze";
import { PLUME_COLORS, sparkBase } from "../../data/plumeColors";
import { beamState } from "../../store/beamState";
import { reelStep } from "../../utils/tractorBeam";
import { cruiseCap } from "../../utils/speedCap";
import { clampRaceVelocity, cruiseLimit, freeDistance, shipWarpSpeed } from "../../utils/cruise";
import { gridPose } from "../../utils/raceScene";
import { WARP_LANDMARKS } from "../../utils/warpLandmarks";
import {
  stepGravity, gravityMode, SlingshotWatch, wellAt, SUN_WELL_ID, type Well,
  planetWell, SUN_WELL_G, SUN_WELL_RADIUS, G_MAX,
} from "../../utils/gravityWell";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { softSprite } from "./softSprite";
import { makePlumeGeometry, makePlumeMaterial, plumeSpreadFor, PLUME_HALF_ANGLE_DEG, NOZZLE_X, NOZZLE_Y, NOZZLE_Z } from "./enginePlume";
import { assetUrl } from "../../utils/assetUrl";
import { SPAWN, SPAWN_PAD_R } from "../../data/spawn";
import { allOccluders, patchSunShadow } from "./sunShadow";
import { sunVisibility } from "../../utils/sunOcclusion";
import { BODY_REACH } from "../../data/solarSystem";
import { resolveWorldContact, keepCameraOutsideBodies, shakeCamera, SOLID_BODIES } from "../../utils/worldCollide";
import { CHASE_CAM, chaseCamTarget } from "../../utils/chaseCam";

// Per-second physics constants (converted from the old per-frame@60fps values)
const ACCEL = 25.2;         // was 0.007/frame
const MAX_SPEED = SHIP_MAX_SPEED; // was 0.18/frame
const WARP_SPEED = SHIP_WARP_SPEED; // was 0.65/frame
const TURN_SPEED = 2.4;     // rad/s, was 0.04/frame
const SPACE_DRAG = 0.982;   // per-frame decay basis
/**
 * Clear radius of a fixed landmark for cruise's free-space measure. The largest
 * extent is the dormant gate's GATE_RADIUS = 15 (data/dormantGate.ts); the career
 * station and shipyard models are <= 5.3 (retainR 13 in data/careerTrail.ts).
 */
const LANDMARK_CRUISE_R = 15;
/** Each moon's reach (its collider radius), fixed. */
const MOON_REACH = SOLAR_MOONS.map(moonReach);
/**
 * Every sphere warp must leave room for, reused each frame (utils/cruise.ts
 * freeDistance; spec §6.3's d_free): bodies, the Sun, the moons, fixed
 * landmarks, probes.
 */
const CRUISE_SPHERES: { x: number; y: number; z: number; r: number }[] = Array.from(
  { length: BODY_REACH.length + 1 + SOLAR_MOONS.length + WARP_LANDMARKS.length + PROBES.length },
  () => ({ x: 0, y: 0, z: 0, r: 0 }),
);
const BRAKE = 0.92;         // per-frame decay basis
/**
 * Idle bob amplitude, calibrated by eye at animScale 4 and baked. Started at
 * 0.025 (~1.6% of the ship's own size) which measured as moving but was
 * invisible; 0.48 is roughly a third of the ship's height — a pronounced
 * hover on the most centrally-framed object in the game.
 */
const SHIP_IDLE_BOB = 0.48;

// Frame-rate independent lerp: equivalent to lerp(a, b, k) once per frame at 60fps.
const frameLerp = (k: number, dt: number) => 1 - Math.pow(1 - k, dt * 60);

/** Outward drift after breaking orbit, so the ship keeps opening the gap. */
const ESCAPE_SPEED = 4;

/**
 * Nozzle exit centres in ship space: the GLB's Engine_Emissive clusters at
 * model (±0.582, -0.05, 3.25) with exit lips at z 3.5, scaled 0.35 and
 * turned π about Y.
 */

/** Chase-camera scratch vectors (no per-frame allocation). */
const _camTarget = new THREE.Vector3();
const _camSide = new THREE.Vector3();
/** Jump and spawn-aim targets (no per-frame allocation). */
const _jumpTarget = { x: 0, y: 0, z: 0 };
const _aim = { x: 0, y: 0, z: 0 };

/** Probe 1's home: the spot the ship faces from the spawn point (src/data/spawn.ts). */
const FIRST_PROBE_HOME = PROBES[0].home;

// Collisions: big scenery asteroids + the sun (belt is decorative — excluded)
const COLLIDERS = [...ASTEROID_COLLIDERS, SUN_COLLIDER];
/**
 * Every solid body's live centre, by SOLID_BODIES id: the bodies' `bodies`
 * entries and the moons' `moonPositions` entries. Merged once:
 * it holds the same objects their writers update in place, so it stays live
 * and the frame loop reads it without allocating.
 */
const SOLID_CENTERS: Readonly<Record<string, { x: number; y: number; z: number }>> = { ...bodies, ...moonPositions };

/**
 * Gravity wells, one per body plus the sun, reused every frame:
 * body entries are refreshed from `bodies`, and the active ones are copied to
 * the front of ACTIVE_WELLS so stepGravity takes a count instead of a fresh array.
 */
const BODY_WELLS: Well[] = BODY_REACH.map(planetWell);
const SUN_WELL: Well = { x: SUN_COLLIDER.x, y: SUN_COLLIDER.y, z: SUN_COLLIDER.z, g: SUN_WELL_G, radius: SUN_WELL_RADIUS, rMin: SUN_COLLIDER.r };
const ACTIVE_WELLS: Well[] = Array.from({ length: BODY_REACH.length + 1 }, () => ({ ...SUN_WELL }));
/** Names ACTIVE_WELLS for the slingshot watch, in the same order: the bodies, then the Sun. */
const WELL_IDS = [...BODY_REACH.map((b) => b.key), SUN_WELL_ID];
const slingshotLines = new ChatterScheduler(chatterPools);
/**
 * The engine material's original emissive colour, captured the first time the
 * cached GLTF material is seen. A remount (classic-résumé round trip) with a
 * non-stock plume must not capture the tint as "stock".
 */
const stockEmissive = new WeakMap<THREE.Material, THREE.Color>();
/**
 * Each Neon_* strip's own emissive intensity, captured the first time the
 * cached GLTF material is seen (it outlives a remount), so the frame loop can
 * write base × glowScale without compounding.
 */
const neonBase = new WeakMap<THREE.Material, number>();
/** The warp streaks' colour at 1 AU; the frame loop writes it × glowScale. */
const STREAK_BASE = new THREE.Color("#00f0ff");
const PLUME_NOZZLE_R = 0.07;

/** Spark base colour for the current plume (written on plume change, read by the spark loop). */
const sparkRGB: [number, number, number] = [0.55, 1, 1];
/** SlingshotWatch result scratch. */
const slingshotOut = { whoosh: false, line: false };
/** Total velocity (pilot + gravity) scratch. */
const _total = new THREE.Vector3();
/**
 * How much of the sun the player ship sees (F4, docs/UNIVERSE-RULES.md L20),
 * shared by all its hull materials. Module-level because the GLTF scene, and
 * so its patched materials, outlive a remount (the classic-résumé round
 * trip): a patch is applied once and keeps the uniform it was given.
 */
const SHIP_SUN_VIS = { value: 1 };

export default function Spaceship() {
  const { scene } = useModel(assetUrl("/models/spaceship.glb"));
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);

  // Dim incidental emissives, but keep the engine material hot — it paints the
  // ship's three real nozzle spots, and the frame loop drives it with throttle.
  // Materials named Neon_* are deliberate accent strips/nav lights on the
  // generated ship (scripts/blender/gen_spaceship.py) and keep their glow.
  const engineMat = useMemo(() => {
    let engine: THREE.MeshStandardMaterial | null = null;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (/engine/i.test(mat.name)) engine = mat;
        else if (mat.emissive && !/^neon_/i.test(mat.name)) mat.emissiveIntensity = 0.08;
      }
    });
    return engine as THREE.MeshStandardMaterial | null;
  }, [scene]);
  // The Neon_* strips are self-lit: held at their 1 AU glow far out (glowScale).
  const neonMats = useMemo(() => {
    const out: { mat: THREE.MeshStandardMaterial; base: number }[] = [];
    const seen = new Set<THREE.Material>();
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.material) return;
      const mat = child.material as THREE.MeshStandardMaterial;
      if (seen.has(mat) || !mat.emissive || !/^neon_/i.test(mat.name)) return;
      seen.add(mat);
      if (!neonBase.has(mat)) neonBase.set(mat, mat.emissiveIntensity);
      out.push({ mat, base: neonBase.get(mat)! });
    });
    return out;
  }, [scene]);
  // Eclipses: every lit hull material (the GLB's own; the race ghost and the
  // live-sky ghosts clone the scene and swap in their own materials) scales
  // the sun's light by SHIP_SUN_VIS, measured on the CPU each frame below.
  const hullMats = useMemo(() => {
    const mats = new Set<THREE.Material>();
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
        if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) mats.add(m);
      }
    });
    for (const m of mats) patchSunShadow(m, "object", { sunVis: SHIP_SUN_VIS });
    return [...mats];
  }, [scene]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.shipShadow = { sunVis: SHIP_SUN_VIS, materials: hullMats };
    return () => { fitzDebug.shipShadow = null; };
  }, [hullMats]);

  const engineStockEmissive = useMemo(() => {
    if (!engineMat) return new THREE.Color("#00f0ff");
    if (!stockEmissive.has(engineMat)) stockEmissive.set(engineMat, engineMat.emissive.clone());
    return stockEmissive.get(engineMat)!;
  }, [engineMat]);

  // The spawn pad, or a race link's grid slot for the page's first ship (flightState.ts).
  const [start] = useState(shipStartPose);
  useEffect(() => markShipStarted(), []);
  const pos = useRef(new THREE.Vector3(start.x, start.y, start.z));
  const vel = useRef(new THREE.Vector3(0, 0, 0)); // units/second
  // Gravity momentum (spec §5): built by wells, decays slowly; the ship moves
  // by vel + gravity. Zeroed wherever the ship is placed, docked or bounced.
  const gravity = useRef({ x: 0, y: 0, z: 0 });
  const idleFor = useRef(0);
  /** Well exits -> whoosh and slingshot callout (gravityWell.ts). */
  const slingshotWatch = useRef(new SlingshotWatch());
  const zeroGravity = () => { gravity.current.x = 0; gravity.current.y = 0; gravity.current.z = 0; };

  // Dev-only: e2e probes and the QA checklist need to reposition the ship.
  // `flight` cannot be used for this — it is written FROM pos every frame, so
  // assigning to it is a no-op. Registering here is the only way to reach pos.
  // The telemetry is mirrored at once too: a probe reading `flight` before the
  // next frame would otherwise see the old spot.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.teleport = (x: number, y: number, z: number) => {
      pos.current.set(x, y, z);
      vel.current.set(0, 0, 0);
      zeroGravity();
      markShipTeleport();
      flight.x = x; flight.y = y; flight.z = z;
      flight.speed = 0;
    };
    fitzDebug.setAttitude = (yaw: number, nosePitch: number) => {
      angle.current = yaw;
      pitch.current = nosePitch;
      turnVelocity.current = 0;
      pitchVel.current = 0;
      hasFlown.current = true;
      flight.hasFlown = true;
    };
    fitzDebug.gravity = gravity.current;
    fitzDebug.beam = beamState;
    fitzDebug.fuelDebug = fuelDebug;
    return () => { fitzDebug.teleport = null; fitzDebug.setAttitude = null; fitzDebug.gravity = null; fitzDebug.beam = null; fitzDebug.fuelDebug = null; };
  }, []);

  // Spawn nose-on to the first probe, so the first W press flies toward a
  // project rather than into empty space.
  const angle = useRef(start.heading ?? headingToward(SPAWN.x, SPAWN.z, FIRST_PROBE_HOME[0], FIRST_PROBE_HOME[2]));
  const roll = useRef(0);
  const pitch = useRef(start.pitch);
  const turnVelocity = useRef(0); // rad/second
  const pitchVel = useRef(0); // rad/s — `pitch` ref (above) is now flight state, not just visual
  const shake = useRef(0);
  const lastImpactAt = useRef(-1);
  const warpSuppressUntil = useRef(-1);
  /** After a bounce off the sun, an asteroid or a world: the ship's position and velocity are already resolved. */
  const impact = (time: number) => {
    zeroGravity(); // momentum into the body would just hit it again
    warpSuppressUntil.current = time + 0.45; // let the reflection push us away
    if (time - lastImpactAt.current > 0.5) {
      lastImpactAt.current = time;
      shake.current = 0.5; // the camera skips it under reduced motion
      soundManager.impact();
      useSpaceStore.getState().bumpImpact();
    }
  };
  /** The last `combat.hits` seen: a change is a Nest hull hit to feel. */
  const seenHits = useRef(combat.hits);
  const edgeCut = useRef(false);
  const warpSpeed = useRef(WARP_SPEED);
  // False until the pilot's first input. Until then the parked ship keeps its
  // nose on the first probe, so the first W press flies toward a project.
  // A race link's ship starts on the grid, not the pad: nothing to auto-aim.
  const hasFlown = useRef(start.race);
  // A requested jump target, applied by the frame loop. Held in a ref rather
  // than applied in the store subscription: an open dossier freezes the frame
  // loop, so the jump first breaks orbit and lands on the next live frame.
  const pendingJump = useRef<string | null>(null);
  const snapCamera = useRef(true); // first frame snaps: the camera starts at the spawn, not the canvas default
  /** The race grid slot the ship was last put on (raceScene.ts gridPose key): placed once per race and slot. */
  const placedFor = useRef<string | null>(null);
  useEffect(() => useSpaceStore.subscribe(
    (s) => s.jumpRequest,
    (req) => {
      if (!req) return;
      pendingJump.current = req.id;
      const s = useSpaceStore.getState();
      if (s.isOrbitLocked) s.breakOrbit();
    },
  ), []);

  const lockedCenter = useRef(new THREE.Vector3());
  const targetLockRadius = useRef(6);
  const escapeRadius = useRef(10);
  const orbitRadius = useRef(6); // eased ring radius — starts at arrival distance, eases toward targetLockRadius
  const orbitAngle = useRef(0);

  const prevOrbitLocked = useRef(false);
  useEffect(() => {
    const wasLocked = prevOrbitLocked.current;
    prevOrbitLocked.current = isOrbitLocked;

    if (!wasLocked && isOrbitLocked) {
      // Lock entry: resolve the locked destination (only destinations dock;
      // planets are solid, spec §4.4) and start the orbit from wherever the
      // ship arrived (no snap).
      zeroGravity();
      const dest = destinationById(useSpaceStore.getState().activeZone);
      if (dest) {
        lockedCenter.current.set(dest.pos[0], dest.pos[1], dest.pos[2]);
        targetLockRadius.current = dest.orbitR;
        escapeRadius.current = escapeR(dest);
      } else {
        // Shouldn't happen, but never crash: orbit in place.
        lockedCenter.current.copy(pos.current);
        targetLockRadius.current = 6;
        escapeRadius.current = 10;
      }
      // Ease the ring out/in from wherever the ship arrived, rather than
      // snapping straight to the target radius (see tests/orbitInvariant.test.ts).
      orbitRadius.current = Math.hypot(
        pos.current.x - lockedCenter.current.x,
        pos.current.z - lockedCenter.current.z
      );
      orbitAngle.current = Math.atan2(
        pos.current.x - lockedCenter.current.x,
        pos.current.z - lockedCenter.current.z
      );
      return;
    }

    if (!wasLocked || isOrbitLocked) return; // only true→false = real orbit break
    // Out along the destination->ship line past its zone and retain radius
    // (escapeR), then drift outward. The old fixed 2.8u push backwards along
    // the nose left the ship inside the lock radius.
    const out = escapePosition(pos.current, lockedCenter.current, escapeRadius.current);
    pos.current.set(out.x, out.y, out.z);
    markShipTeleport();
    vel.current.subVectors(pos.current, lockedCenter.current).setLength(ESCAPE_SPEED);
    zeroGravity();
  }, [isOrbitLocked]);

  const shipRef = useRef<THREE.Group>(null);
  const engineLightRef = useRef<THREE.PointLight>(null);

  // Fine sparks shed from the plumes, dimming as they age (vertex colour).
  // Was 20 large soft dots that read as floating bubbles.
  const particleCount = 48;
  const [particleGeometry, particleVelocities] = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(particleCount * 3);
    const colArr = new Float32Array(particleCount * 3);
    const vArr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      // seed each particle behind one of the three nozzles
      posArr[i * 3] = NOZZLE_X[i % 3] + (Math.random() - 0.5) * 0.05;
      posArr[i * 3 + 1] = NOZZLE_Y + (Math.random() - 0.5) * 0.05;
      posArr[i * 3 + 2] = NOZZLE_Z - Math.random() * 1.4;
      vArr[i * 3] = (Math.random() - 0.5) * 0.012;
      vArr[i * 3 + 1] = (Math.random() - 0.5) * 0.012;
      vArr[i * 3 + 2] = -0.06 - Math.random() * 0.06;
    }
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    return [geom, vArr];
  }, []);

  // Engine plumes (enginePlume.ts), one per nozzle.
  const plumeGeometry = useMemo(() => makePlumeGeometry(PLUME_NOZZLE_R), []);
  const plumeMaterials = useMemo(() => NOZZLE_X.map((_, i) => makePlumeMaterial(i * 1.7)), []);
  useEffect(() => () => { plumeGeometry.dispose(); plumeMaterials.forEach((m) => m.dispose()); },
    [plumeGeometry, plumeMaterials]);
  const plumeMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const plumeLen = useRef(0.35);
  const plumePower = useRef(0.25);
  /** Eases plume length/brightness toward a throttle target. */
  const drivePlumes = (targetLen: number, targetPower: number, t: number, dt: number) => {
    const k = frameLerp(0.18, dt);
    plumeLen.current += (targetLen - plumeLen.current) * k;
    plumePower.current += (targetPower - plumePower.current) * k;
    for (let i = 0; i < plumeMaterials.length; i++) {
      const m = plumeMeshes.current[i];
      if (m) {
        m.scale.y = plumeLen.current;
        m.position.z = NOZZLE_Z - plumeLen.current / 2;
      }
      plumeMaterials[i].uniforms.uTime.value = t;
      plumeMaterials[i].uniforms.uPower.value = plumePower.current;
      plumeMaterials[i].uniforms.uSpread.value = plumeSpreadFor(plumeLen.current, PLUME_NOZZLE_R, PLUME_HALF_ANGLE_DEG);
    }
  };
  const particlesRef = useRef<THREE.Points>(null);
  /** The nozzles' burn level at 1 AU, eased by the flight loop; written × glowScale below. */
  const engineBurn = useRef(0.7);

  // Logbook plume colour (spec §5): uniform and CPU colour changes only, once
  // per change. The hot white core stays; the cool end, sparks, engine light
  // and nozzle glow take the colour. Stock restores the original cyan.
  useEffect(() => {
    const apply = (id: string) => {
      const hex = (PLUME_COLORS[id] ?? PLUME_COLORS.stock).hex;
      for (const m of plumeMaterials) (m.uniforms.uColor.value as THREE.Color).set(hex);
      if (id === "stock") { sparkRGB[0] = 0.55; sparkRGB[1] = 1; sparkRGB[2] = 1; } else sparkBase(hex, sparkRGB);
      if (engineLightRef.current) engineLightRef.current.color.set(id === "stock" ? "#00f0ff" : hex);
      if (engineMat) engineMat.emissive.copy(id === "stock" ? engineStockEmissive : new THREE.Color(hex));
    };
    apply(useSpaceStore.getState().plumeColor);
    return useSpaceStore.subscribe((s) => s.plumeColor, apply);
  }, [plumeMaterials, engineMat, engineStockEmissive]);

  const streakCount = 60;
  const streakGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(streakCount * 2 * 3);
    for (let i = 0; i < streakCount; i++) {
      const x = (Math.random() - 0.5) * 8.0;
      const y = (Math.random() - 0.5) * 6.0;
      const z = (Math.random() - 0.5) * 10.0;
      posArr.set([x, y, z, x, y, z - 0.05], i * 6);
    }
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    return geom;
  }, []);
  const streaksRef = useRef<THREE.LineSegments>(null);

  useFrame((state, delta) => {
    if (!shipRef.current) return;
    const dt = Math.min(delta, 0.05); // clamp tab-switch spikes
    const store = useSpaceStore.getState();
    const rawElapsed = state.clock.getElapsedTime();
    // `time` drives warp suppression and impact debounce below (both compare
    // against an absolute deadline stored from an earlier frame), so it must
    // survive a THREE.Clock reset (Task 6's dossier freeze flips `frameloop`
    // twice per open+close, and R3F's setFrameloop zeroes clock.elapsedTime on
    // each transition) — see utils/ambientTime.ts's gameTime() doc comment.
    const time = gameTime(rawElapsed);
    // Sub-perceptual idle flourishes (bob, roll wobble) are decorative, not
    // physics, so they freeze under reduced motion like any other Tier 2
    // effect — the ship's position/physics themselves stay on `time` (spec §1).
    const ambient = ambientTime(rawElapsed);


    if (store.photoMode) {
      // Photo mode: freeze input/physics/camera/shake entirely so OrbitControls
      // owns the camera. The ship just idles in place — bob + a low idle
      // plume glow — at whatever pos.current was when
      // photo mode was toggled on. flight.x/y/z are republished from the same
      // frozen pos.current, so they hold steady (nothing here advances them).
      shipRef.current.position.y = pos.current.y + Math.sin(ambient * 2) * 0.05;
      drivePlumes(0.35, 0.25, time, dt);
      store.setWarping(false);
      flight.edgeBurn = false;
      beamState.active = false; beamState.reel.active = false;
      flight.x = pos.current.x; flight.z = pos.current.z; flight.y = pos.current.y;
      flight.pitch = pitch.current;
      return;
    }

    const input = flight.input;

    // Chase-cam follow + FOV, shared by free flight and orbit lock so the
    // camera keeps framing the ship in both states.
    const applyChaseCam = (warpActive: boolean, orbiting = false) => {
      const rm = store.reducedMotion;
      // Speed-driven framing: the camera eases back and the lens widens a
      // little with throttle, more at warp — the "push" of acceleration.
      const speedNorm = Math.min(1, _total.length() / MAX_SPEED);
      const camDistance = warpActive ? CHASE_CAM.warpDistance : CHASE_CAM.distance + CHASE_CAM.speedGain * speedNorm;
      const camHeight = (warpActive ? CHASE_CAM.warpHeight : CHASE_CAM.height) + (orbiting && !rm ? 0.8 : 0);
      const targetFov = warpActive ? 86 : 58 + (rm ? 0 : 6 * speedNorm);
      const perspCam = state.camera as THREE.PerspectiveCamera;
      if (Math.abs(perspCam.fov - targetFov) > 0.01) {
        perspCam.fov = snapCamera.current ? targetFov : THREE.MathUtils.lerp(perspCam.fov, targetFov, frameLerp(0.08, dt));
        perspCam.updateProjectionMatrix();
      }
      const nose = noseDirection(angle.current, pitch.current);
      // Turn lag: the camera swings slightly to the outside of a turn, so
      // the ship visibly carves rather than the world rotating around it.
      // Orbit lock adds a slow cinematic offset to one side.
      const swing = rm ? 0 : (orbiting ? 1.6 : -turnVelocity.current * 0.55);
      _camSide.set(nose.z, 0, -nose.x).normalize().multiplyScalar(swing);
      chaseCamTarget(_camTarget, pos.current, nose, camDistance, camHeight, _camSide);
      // A jump snaps the camera with the ship: easing across ~150u would swing
      // it through the sun, and is exactly the motion reduced motion avoids.
      const cut = snapCamera.current;
      const f = cut ? 1 : frameLerp(orbiting ? 0.02 : 0.05, dt);
      snapCamera.current = false;
      state.camera.position.lerp(_camTarget, f);
      // The ship rests only half a length off a planet's, world's or moon's surface,
      // so the camera behind it would sit inside: keep it out (worldCollide.ts).
      keepCameraOutsideBodies(state.camera.position, SOLID_CENTERS);
      // The exposure, the fill and the backdrop are re-metered with the camera (I2):
      // ExposureDriver ran earlier this frame, so without this the cut frame
      // is mis-exposed.
      if (cut) {
        const d = state.camera.position.length();
        cutExposure(state.gl, d, !store.isLowPerf);
        applyFill(state.scene, d);
        applyBackdrop(state.scene, d);
      }
      state.camera.lookAt(
        pos.current.x + nose.x * 1.5,
        pos.current.y + nose.y * 1.5 + 0.2,
        pos.current.z + nose.z * 1.5
      );
    };

    // Race grid: the ship is put on its slot behind the start gate once per
    // race and slot, then held still (RaceCourse sets flight.raceHold) until
    // GO, like photo mode's freeze but with the chase camera still following.
    const grid = gridPose(store.raceView);
    const placed = grid !== null && grid.key !== placedFor.current;
    if (grid && placed) {
      placedFor.current = grid.key;
      pos.current.set(grid.p.x, grid.p.y, grid.p.z);
      angle.current = grid.heading;
      pitch.current = grid.pitch;
      roll.current = 0;
      pendingJump.current = null;
      hasFlown.current = true;
      flight.hasFlown = true;
      snapCamera.current = true;
      markShipTeleport();
      store.triggerTeleportFlash();
    }
    if (placed || flight.raceHold) {
      // A breach tow asked for now is dropped, not kept for GO (C28).
      takeTowRequest(combat, true);
      vel.current.set(0, 0, 0);
      zeroGravity();
      _total.set(0, 0, 0);
      turnVelocity.current = 0;
      pitchVel.current = 0;
      warpSpeed.current = WARP_SPEED;
      shipRef.current.position.copy(pos.current);
      shipRef.current.position.y += Math.sin(ambient * 2) * SHIP_IDLE_BOB;
      shipRef.current.rotation.set(-pitch.current, angle.current, roll.current, "YXZ");
      drivePlumes(0.35, 0.25, time, dt);
      store.setWarping(false);
      flight.edgeBurn = false;
      beamState.active = false; beamState.reel.active = false;
      flight.x = pos.current.x; flight.z = pos.current.z; flight.y = pos.current.y;
      flight.heading = angle.current;
      flight.pitch = pitch.current;
      flight.speed = 0;
      applyChaseCam(false);
      store.setNearSpawn(Math.abs(pos.current.x - SPAWN.x) < SPAWN_PAD_R && Math.abs(pos.current.z - SPAWN.z) < SPAWN_PAD_R && Math.abs(pos.current.y - SPAWN.y) < 3);
      return;
    }

    if (isOrbitLocked) {
      // Destinations hold still, so the lock centre captured at entry stands.
      orbitRadius.current += (targetLockRadius.current - orbitRadius.current) * frameLerp(0.03, dt);
      // Continuing revolution is the involuntary, large-field motion reduced
      // motion targets — gate only this increment. The easings above/below
      // (radius settling, bank/level-out) still run so the ship glides to its
      // orbital station and settles rather than snapping or hanging mid-approach.
      if (!store.reducedMotion) orbitAngle.current += dt * 0.25;
      pos.current.x = lockedCenter.current.x + Math.sin(orbitAngle.current) * orbitRadius.current;
      pos.current.z = lockedCenter.current.z + Math.cos(orbitAngle.current) * orbitRadius.current;
      pos.current.y += (lockedCenter.current.y - pos.current.y) * frameLerp(0.04, dt);
      angle.current = orbitAngle.current + Math.PI / 2; // face the orbit tangent
      roll.current = THREE.MathUtils.lerp(roll.current, -0.15, frameLerp(0.05, dt)); // gentle bank
      pitch.current = THREE.MathUtils.lerp(pitch.current, 0, frameLerp(0.05, dt)); // level out in orbit
      vel.current.set(0, 0, 0);
      pitchVel.current = 0;
      shipRef.current.position.copy(pos.current);
      shipRef.current.position.y += Math.sin(ambient * 2) * 0.05; // bob
      shipRef.current.rotation.set(-pitch.current, angle.current, roll.current, "YXZ");
      drivePlumes(0.3, 0.2, time, dt);
      store.setWarping(false);
      flight.x = pos.current.x; flight.z = pos.current.z; flight.y = pos.current.y;
      flight.heading = angle.current;
      flight.pitch = pitch.current;
      // A parked ship reports zero tangential speed under reduced motion,
      // matching the frozen orbitAngle above.
      flight.speed = store.reducedMotion ? 0 : orbitRadius.current * 0.25; // tangential speed for the HUD

      zeroGravity();
      _total.set(0, 0, 0);
      flight.edgeBurn = false;
      beamState.active = false; beamState.reel.active = false;
      applyChaseCam(false, true);
      return;
    }

    // Jump: drop in nose-on, level with the target, at its standoff. A probe
    // has no lock and opens nothing: the pilot grabs it with the beam. The
    // post-break cooldown is cleared so a destination's lock engages at once.
    if (pendingJump.current) {
      const id = pendingJump.current;
      pendingJump.current = null;
      // A probe mid-burn is headed for its next spot: aim there (probeJumpTarget).
      const probe = probeJumpTarget(id, probePos, probeRelocating, store.probeSpots, _jumpTarget);
      const dest = probe ? undefined : destinationById(id);
      const target = probe ? _jumpTarget : (dest && { x: dest.pos[0], y: dest.pos[1], z: dest.pos[2] });
      const standoff = probe ? PROBE_JUMP_STANDOFF : dest?.jumpR;
      if (target && standoff !== undefined) {
        const j = jumpPoint(pos.current, target, standoff);
        pos.current.set(j.x, j.y, j.z);
        vel.current.set(0, 0, 0);
        zeroGravity();
        angle.current = j.yaw;
        pitch.current = 0;
        turnVelocity.current = 0;
        pitchVel.current = 0;
        hasFlown.current = true;
        flight.hasFlown = true;
        snapCamera.current = true;
        markShipTeleport();
        useSpaceStore.setState({ isOrbitCooldown: false });
        store.triggerTeleportFlash();
      }
    }

    // The Nest's breach tow (NestDirector asks): like a jump, to just past the
    // buoy, nose on the Nest, at rest.
    if (takeTowRequest(combat, false)) {
      pos.current.set(NEST_TOW_POSE.x, NEST_TOW_POSE.y, NEST_TOW_POSE.z);
      vel.current.set(0, 0, 0);
      zeroGravity();
      angle.current = NEST_TOW_POSE.yaw;
      pitch.current = NEST_TOW_POSE.pitch;
      turnVelocity.current = 0;
      pitchVel.current = 0;
      warpSpeed.current = WARP_SPEED;
      hasFlown.current = true;
      flight.hasFlown = true;
      snapCamera.current = true;
      markShipTeleport();
      store.triggerTeleportFlash();
    }

    // A Nest hull hit (NestDirector bumps combat.hits, throttled to one per
    // 0.25 s): a shake (the camera skips it under reduced motion), the impact
    // thump and a pad rumble. Not impact(): no gravity or warp side effects,
    // and no bumpImpact, which would also fire the radio's impact line (C3).
    if (combat.hits !== seenHits.current) {
      seenHits.current = combat.hits;
      shake.current = 0.5;
      soundManager.impact();
      padRumble();
    }

    // 0. Pre-flight auto-aim. A visitor reads the spawn banner for a while
    // before touching anything. Aim straight (yaw and pitch) at the probe the
    // waypoint picks, the nearest unread one (spawnAimPoint), until the first
    // input, then hand over and never touch the controls again.
    if (!hasFlown.current) {
      const touched = input.forward || input.backward || input.left || input.right
        || input.ascend || input.descend || input.boost || input.beam || input.steer !== 0 || input.thrust !== 0;
      // Leaving the spawn pad by any other route (a dev/e2e teleport, a
      // collision push) also ends the auto-aim: it only exists to point a
      // parked, untouched ship at the first probe.
      if (touched || !store.isNearSpawn) {
        hasFlown.current = true;
        flight.hasFlown = true;
      } else {
        const home = _aim;
        spawnAimPoint(pos.current, probePos, store.visitedDossiers, home);
        const aimYaw = headingToward(pos.current.x, pos.current.z, home.x, home.z);
        const aimPitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX,
          Math.atan2(home.y - pos.current.y, Math.hypot(home.x - pos.current.x, home.z - pos.current.z))));
        const k = frameLerp(0.04, dt);
        // Shortest way round, so the nose never spins the long way.
        const dYaw = Math.atan2(Math.sin(aimYaw - angle.current), Math.cos(aimYaw - angle.current));
        angle.current += dYaw * k;
        pitch.current += (aimPitch - pitch.current) * k;
      }
    }

    // 1. Steering: keyboard is full-rate, touch joystick is analog
    const steerInput = input.left ? 1 : input.right ? -1 : -input.steer;
    if (steerInput !== 0) {
      turnVelocity.current = THREE.MathUtils.lerp(turnVelocity.current, TURN_SPEED * steerInput, frameLerp(0.07, dt));
      roll.current = THREE.MathUtils.lerp(roll.current, 0.42 * steerInput, frameLerp(0.07, dt));
    } else {
      turnVelocity.current = THREE.MathUtils.lerp(turnVelocity.current, 0, frameLerp(0.12, dt));
      roll.current = THREE.MathUtils.lerp(roll.current, 0, frameLerp(0.12, dt));
    }
    angle.current += turnVelocity.current * dt;

    // 2. Pitch channel: nose angle, eased like yaw. No auto-level, no ceiling —
    // the nose and the ship stay wherever the pilot leaves them (spec §1).
    const pRes = pitchStep(pitch.current, pitchVel.current,
      { up: input.ascend, down: input.descend }, dt);
    pitch.current = pRes.pitch;
    pitchVel.current = pRes.pitchVel;

    // 3. Warp vs impulse along the nose direction. Touch thrust is analog.
    // Briefly suppressed right after an impact so the reflected velocity can
    // actually push the ship away instead of being overwritten by warp speed.
    // Warp needs fuel. Ordering is deliberate: the drain is conditioned on the
    // same `warpActive` the velocity branch uses, so the gate and the drain can
    // never disagree about whether warp happened this frame. Holding Shift on an
    // empty tank drains nothing and simply cruises; the tank refills only while
    // Shift is released (stepFuel).
    //
    // Running dry is a graceful coast, not a stop: the warp branch below assigns
    // velocity directly, so when it stops running the ship keeps its 39 u/s and
    // decays through the existing SPACE_DRAG.
    // The edge cut is latched (see edgeLatch): the burn returning the ship to the
    // radius must not re-engage warp and point it outward again.
    edgeCut.current = edgeLatch(edgeCut.current, Math.hypot(pos.current.x, pos.current.y, pos.current.z), input.boost);
    const warpActive = input.boost && time > warpSuppressUntil.current && flight.fuel > 0 && !edgeCut.current;
    flight.fuel = stepFuel(flight.fuel, dt, input.boost || fuelDebug.holdRegen, warpActive);
    store.setFuelEmpty(flight.fuel <= 0);
    store.setWarping(warpActive);
    const thrustInput = input.forward ? 1 : Math.max(0, input.thrust);
    const braking = input.backward || input.thrust < -0.2;

    const nose = noseDirection(angle.current, pitch.current);

    // Tractor beam (spec §6): off in warp; the nose is its origin and axis.
    // In the Nest's fighting area the same key fires the plasma gun instead (NestDirector).
    beamState.active = input.beam && !warpActive && beamUse(combat.inArea) === "beam";
    beamState.ox = pos.current.x + nose.x * 1.3; beamState.oy = pos.current.y + nose.y * 1.3; beamState.oz = pos.current.z + nose.z * 1.3;
    beamState.dx = nose.x; beamState.dy = nose.y; beamState.dz = nose.z;
    if (!beamState.active) beamState.oreStreak = 0;

    // Caps sit before the drag below; cruiseCap keeps the post-drag speed the
    // same at every frame rate (the tuning targets are measured at 60 fps).
    // Each warp starts at the base speed and builds (utils/cruise.ts).
    if (!warpActive) warpSpeed.current = WARP_SPEED;
    if (warpActive) {
      let n = 0;
      for (let i = 0; i < BODY_REACH.length; i++) {
        const b = bodies[BODY_REACH[i].key], c = CRUISE_SPHERES[n++];
        c.x = b.x; c.y = b.y; c.z = b.z; c.r = BODY_REACH[i].reach;
      }
      const sun = CRUISE_SPHERES[n++];
      sun.x = SUN_WELL.x; sun.y = SUN_WELL.y; sun.z = SUN_WELL.z; sun.r = SUN_RADIUS;
      for (let i = 0; i < SOLAR_MOONS.length; i++) {
        const q = moonPositions[SOLAR_MOONS[i].id], c = CRUISE_SPHERES[n++];
        c.x = q.x; c.y = q.y; c.z = q.z; c.r = MOON_REACH[i];
      }
      for (let i = 0; i < WARP_LANDMARKS.length; i++) {
        const l = WARP_LANDMARKS[i], c = CRUISE_SPHERES[n++];
        c.x = l[0]; c.y = l[1]; c.z = l[2]; c.r = LANDMARK_CRUISE_R;
      }
      for (let i = 0; i < PROBES.length; i++) {
        const q = probePos[PROBES[i].id], c = CRUISE_SPHERES[n++];
        c.x = q.x; c.y = q.y; c.z = q.z; c.r = PROBE_RADIUS;
      }
      // Racers are held to the base warp speed: the same top speed for every
      // pilot. So is warp in the Nest's fighting area (shipWarpSpeed).
      warpSpeed.current = shipWarpSpeed(warpSpeed.current, flight.racing, combat.inArea, cruiseLimit(freeDistance(pos.current, CRUISE_SPHERES, n, SYSTEM_RADIUS)), dt);
      const warp = cruiseCap(warpSpeed.current, SPACE_DRAG, dt);
      vel.current.set(nose.x * warp, nose.y * warp, nose.z * warp);
    } else if (thrustInput > 0) {
      vel.current.x += nose.x * ACCEL * thrustInput * dt;
      vel.current.y += nose.y * ACCEL * thrustInput * dt;
      vel.current.z += nose.z * ACCEL * thrustInput * dt;
      const cap = cruiseCap(MAX_SPEED, SPACE_DRAG, dt);
      if (vel.current.length() > cap) vel.current.normalize().multiplyScalar(cap);
    } else if (braking) {
      vel.current.multiplyScalar(Math.pow(BRAKE, dt * 60));
    }
    // Reeling toward a shard counts as thrust for station-keeping.
    const reeling = beamState.active && beamState.reel.active;
    if (reeling) reelStep(vel.current, beamState.reel.x, beamState.reel.y, beamState.reel.z, dt, cruiseCap(MAX_SPEED, SPACE_DRAG, dt));
    vel.current.multiplyScalar(Math.pow(SPACE_DRAG, dt * 60));

    // Gravity wells (spec §5): momentum G on top of the unchanged pilot velocity.
    idleFor.current = thrustInput > 0 || reeling ? 0 : idleFor.current + dt;
    let wellCount = 0;
    for (let i = 0; i < BODY_REACH.length; i++) {
      const b = bodies[BODY_REACH[i].key], src = BODY_WELLS[i], dst = ACTIVE_WELLS[wellCount++];
      dst.x = b.x; dst.y = b.y; dst.z = b.z; dst.g = src.g; dst.radius = src.radius; dst.rMin = src.rMin;
    }
    const sunDst = ACTIVE_WELLS[wellCount++];
    sunDst.x = SUN_WELL.x; sunDst.y = SUN_WELL.y; sunDst.z = SUN_WELL.z;
    sunDst.g = SUN_WELL.g; sunDst.radius = SUN_WELL.radius; sunDst.rMin = SUN_WELL.rMin;
    const g = gravity.current;
    // The edge: after the caps (so it overrides warp and thrust), before integration.
    flight.edgeBurn = edgeReturn(pos.current, vel.current, dt);
    stepGravity(g, pos.current, vel.current, ACTIVE_WELLS, wellCount, gravityMode(hasFlown.current, warpActive, idleFor.current), dt);
    // Racing: warp, thrust and gravity together never pass RACE_SPEED (the room's speed rule).
    clampRaceVelocity(vel.current, g, flight.racing);

    pos.current.x += (vel.current.x + g.x) * dt;
    pos.current.y += (vel.current.y + g.y) * dt;
    pos.current.z += (vel.current.z + g.z) * dt;

    // Collisions: big scenery asteroids + the sun (belt is decorative — excluded)
    for (const c of COLLIDERS) {
      const hit = resolveCollision(
        pos.current.x, pos.current.y, pos.current.z,
        vel.current.x, vel.current.y, vel.current.z,
        c.x, c.y, c.z, c.r
      );
      if (hit) {
        pos.current.set(hit.px, hit.py, hit.pz);
        vel.current.set(hit.vx, hit.vy, hit.vz);
        impact(time);
        break;
      }
    }
    // The bodies' and the moons' solid surfaces (worldCollide.ts):
    // they move, so each is read live from SOLID_CENTERS, at its equatorial
    // size. The rings are fly-through.
    for (let i = 0; i < SOLID_BODIES.length; i++) {
      if (resolveWorldContact(pos.current, vel.current, SOLID_CENTERS[SOLID_BODIES[i].id], SOLID_BODIES[i].size)) { impact(time); break; }
    }

    _total.set(vel.current.x + gravity.current.x, vel.current.y + gravity.current.y, vel.current.z + gravity.current.z);
    const totalSpeed = _total.length();
    beamState.vel.x = _total.x; beamState.vel.y = _total.y; beamState.vel.z = _total.z;

    // Which well the ship is in now, the Sun's included; leaving one fast is a slingshot.
    const wellNow = wellAt(pos.current, ACTIVE_WELLS, WELL_IDS, wellCount);
    const sling = slingshotWatch.current.update(
      time, store.broadcast?.id ?? 0, wellNow, totalSpeed,
      Math.hypot(gravity.current.x, gravity.current.y, gravity.current.z), warpActive,
      selectRaceFlying(store), slingshotOut);
    if (sling.whoosh) soundManager.whoosh();
    if (sling.whoosh) store.recordBadge("slingshot"); // logbook: Slingshot
    if (sling.line) store.sendBroadcast(slingshotLines.pick("slingshot"), { silent: true });

    shipRef.current.position.copy(pos.current);
    // Idle bob. Photo mode (:184) and orbit lock (:241) already bobbed, but free
    // flight — where a visitor spends nearly all their time, with the ship dead
    // centre in frame — had none, so the most prominent object on screen sat
    // perfectly still. Purely visual: the chase camera and every physics,
    // collision and radar read use `pos.current`, never `shipRef.position`, so
    // this cannot perturb the camera or gameplay. Smaller amplitude than the
    // other two bobs (0.025 vs 0.05) because in free flight the ship is closer
    // to the camera, so the same offset reads as roughly twice the motion.
    shipRef.current.position.y += Math.sin(ambient * 2) * SHIP_IDLE_BOB;
    // YXZ: yaw first, then pitch about the yawed axis — with the default XYZ,
    // pitch degrades into roll as heading approaches ±90° (see tests/shipPitchOrder.test.ts)
    shipRef.current.rotation.set(
      -pitch.current + Math.sin(ambient * 2) * 0.03,
      angle.current,
      roll.current,
      "YXZ"
    );

    // 3. Thruster scale + engine light breathing with throttle
    const assist = Math.min(1, Math.hypot(gravity.current.x, gravity.current.y, gravity.current.z) / G_MAX);
    drivePlumes(
      (warpActive ? 2.8 : thrustInput > 0 ? 0.8 + 0.9 * thrustInput : 0.35) + assist * 0.9,
      (warpActive ? 2.0 : thrustInput > 0 ? 0.55 + 0.45 * thrustInput : 0.25) + assist * 0.8,
      time, dt);
    if (engineLightRef.current) {
      const targetGlow = (warpActive ? 2.2 : 0.25 + thrustInput * 0.15) * (0.92 + Math.sin(time * 21) * 0.08);
      engineLightRef.current.intensity = THREE.MathUtils.lerp(engineLightRef.current.intensity, targetGlow, frameLerp(0.25, dt));
    }
    // The three nozzle spots themselves: emissive burn follows throttle
    if (engineMat) {
      // Bloom saturates above ~0.2 luminance, so throttling emissive up only
      // grows the aura — hold the idle level and let the exhaust visuals
      // (plume length and brightness, sparks) carry the sense of thrust.
      // The level at 1 AU; the second frame hook writes it × glowScale (the nozzles are self-lit).
      const targetBurn = (warpActive ? 4.5 : 0.7) * (0.94 + Math.sin(time * 23) * 0.06);
      engineBurn.current = THREE.MathUtils.lerp(engineBurn.current, targetBurn, frameLerp(0.3, dt));
    }

    // 4. Exhaust particles (velocities were per-frame — scale by dt*60)
    if (particlesRef.current) {
      const attr = particlesRef.current.geometry.attributes.position;
      const colAttr = particlesRef.current.geometry.attributes.color;
      const data = attr.array as Float32Array;
      const cols = colAttr.array as Float32Array;
      const step = dt * 60;
      const reach = 0.9 + plumeLen.current * 0.8;
      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3;
        data[idx] += particleVelocities[idx] * step;
        data[idx + 1] += particleVelocities[idx + 1] * step;
        data[idx + 2] += particleVelocities[idx + 2] * step * (0.6 + plumePower.current * 0.5);
        if (data[idx + 2] < NOZZLE_Z - reach) {
          data[idx] = NOZZLE_X[i % 3] + (Math.random() - 0.5) * 0.05;
          data[idx + 1] = NOZZLE_Y + (Math.random() - 0.5) * 0.05;
          data[idx + 2] = NOZZLE_Z - 0.05;
        }
        // Brightness falls with age (distance travelled), pale cyan.
        const age = Math.min(1, (NOZZLE_Z - data[idx + 2]) / reach);
        const b = (1 - age) * (1 - age) * (0.35 + 0.4 * plumePower.current);
        cols[idx] = sparkRGB[0] * b; cols[idx + 1] = sparkRGB[1] * b; cols[idx + 2] = sparkRGB[2] * b;
      }
      attr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }

    // 4.5. Local warp streaks
    if (streaksRef.current) {
      const attr = streaksRef.current.geometry.attributes.position;
      const data = attr.array as Float32Array;
      const speed = totalSpeed;
      const zSpeed = (warpActive ? 0.38 : 0.02 + (speed / 60) * 1.5) * dt * 60;
      const stretch = warpActive ? 2.2 : Math.min(0.6, 0.05 + speed * 0.04);
      for (let i = 0; i < streakCount; i++) {
        const head = i * 6;
        data[head + 2] += zSpeed;
        if (data[head + 2] > 5.0) {
          data[head] = (Math.random() - 0.5) * 8.0;
          data[head + 1] = (Math.random() - 0.5) * 6.0;
          data[head + 2] = -5.0;
        }
        data[head + 3] = data[head];
        data[head + 4] = data[head + 1];
        data[head + 5] = data[head + 2] - stretch;
      }
      attr.needsUpdate = true;
    }

    // 5. Camera follow + FOV
    applyChaseCam(warpActive);

    // Shake intentionally freezes while orbit-locked (early return above skips
    // this block entirely) and resumes decaying from wherever it left off
    // once orbit breaks.
    // Kept outside every body afterwards too: right after a push-out the
    // camera rests at a body's camera radius (worldCollide.ts).
    if (shake.current > 0.001 && !useSpaceStore.getState().reducedMotion) {
      shakeCamera(state.camera.position, shake.current, Math.random, SOLID_CENTERS);
    }
    if (shake.current > 0.001) {
      shake.current *= Math.pow(0.03, dt);
    }

    // 6. Publish telemetry (mutable — no React involvement)
    flight.x = pos.current.x;
    flight.z = pos.current.z;
    flight.y = pos.current.y;
    flight.speed = totalSpeed;
    flight.heading = angle.current;
    flight.pitch = pitch.current;
    store.setNearSpawn(Math.abs(pos.current.x - SPAWN.x) < SPAWN_PAD_R && Math.abs(pos.current.z - SPAWN.z) < SPAWN_PAD_R && Math.abs(pos.current.y - SPAWN.y) < 3);
  });

  // The ship in a body's shadow. Runs after the flight loop above, so it
  // sees this frame's position. What shadows it is sunShadow.ts
  // allOccluders: every GPU slot (the bodies with a moon or a ring, and the
  // nine moons) plus Mercury, Venus and Ceres, which shadow nothing the GPU
  // draws but which the ship can fly behind. SolarBodies and SolarMoons write
  // them after this component runs: a frame old, a few hundredths of a unit.
  useFrame(() => {
    SHIP_SUN_VIS.value = sunVisibility(pos.current, allOccluders, SUN_RADIUS);
    // The self-lit parts hold their 1 AU glow far out (glowScale, sunLight.ts):
    // the nozzles, the neon strips, the sparks and the warp streaks. Here, not
    // in the flight loop, so a parked, photo-mode or orbit-locked ship follows
    // the exposure too.
    const g = glowScale.value;
    if (engineMat) engineMat.emissiveIntensity = engineBurn.current * g;
    for (let i = 0; i < neonMats.length; i++) neonMats[i].mat.emissiveIntensity = neonMats[i].base * g;
    if (particlesRef.current) (particlesRef.current.material as THREE.PointsMaterial).color.setScalar(g);
    if (streaksRef.current) (streaksRef.current.material as THREE.LineBasicMaterial).color.copy(STREAK_BASE).multiplyScalar(g);
  });

  return (
    <group ref={shipRef}>
      <primitive object={scene} scale={PLAYER_SHIP_SCALE} rotation={[0, Math.PI, 0]} position={[0, -0.05, 0]} />
      {/* Positions derived from the GLB's Engine_Emissive clusters: nozzles at
          (±0.582, -0.05, 3.25) in model space -> (±0.204, -0.068, -1.14) here,
          exhaust exit plane at z ≈ -1.23. */}
      <pointLight ref={engineLightRef} position={[0, -0.068, -1.5]} color="#00f0ff" intensity={0.3} distance={5} decay={2} />
      {/* Plumes: unit tubes along +Y turned to stream back (-Z) from each
          nozzle; drivePlumes() sets their length every frame. */}
      {NOZZLE_X.map((x, i) => (
        <mesh key={x} ref={(m) => { plumeMeshes.current[i] = m; }}
          geometry={plumeGeometry} material={plumeMaterials[i]}
          position={[x, NOZZLE_Y, NOZZLE_Z - 0.175]} rotation={[Math.PI / 2, 0, 0]}
          scale={[1, 0.35, 1]} frustumCulled={false} />
      ))}
      <points ref={particlesRef} geometry={particleGeometry}>
        {/* Soft sprite: without a map these drew as flat cyan squares. */}
        <pointsMaterial vertexColors={true} size={0.05} map={softSprite} transparent={true} opacity={1}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      <lineSegments ref={streaksRef} geometry={streakGeometry}>
        <lineBasicMaterial color="#00f0ff" transparent={true} opacity={0.5}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </group>
  );
}
