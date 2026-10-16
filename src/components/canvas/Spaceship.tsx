import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { COSMIC_BOUNDS, PLAYER_SHIP_SCALE, SHIP_MAX_SPEED, SHIP_WARP_SPEED, planets, ORBIT_RADIUS_FACTOR, ZONE_FACTOR } from "../../constants";
import { destinationById, escapeR } from "../../data/destinations";
import { flight, useSpaceStore, bodies } from "../../store/spaceStore";
import { fitzDebug } from "../../debug/bridge";
import { pitchStep, noseDirection, headingToward } from "../../utils/pitchFlight";
import { escapePosition } from "../../utils/orbitEscape";
import { interceptAim } from "../../utils/intercept";
import { jumpPoint } from "../../utils/navigation";
import { resolveCollision } from "../../utils/collision";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../../data/asteroids";
import { soundManager } from "../../audio/soundManager";
import { ambientTime, gameTime } from "../../utils/ambientTime";
import { drainFuel } from "../../utils/fuel";
import { wrapCoord } from "../../utils/edgeHaze";
import { keepOutside, CAPTURE_SURFACE_MARGIN } from "../../utils/capture";
import { PLUME_COLORS, sparkBase } from "../../data/plumeColors";
import { beamState } from "../../store/beamState";
import { reelStep } from "../../utils/tractorBeam";
import { cruiseCap } from "../../utils/speedCap";
import {
  stepGravity, gravityMode, EscapeGrace, SlingshotWatch, type Well,
  PLANET_WELL_G, PLANET_WELL_RADIUS_FACTOR, SUN_WELL_G, SUN_WELL_RADIUS, G_MAX,
} from "../../utils/gravityWell";
import { toroidalDistance3 } from "../../utils/toroidal";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { softSprite } from "./softSprite";
import { makePlumeGeometry, makePlumeMaterial, plumeSpreadFor, PLUME_HALF_ANGLE_DEG, NOZZLE_X, NOZZLE_Y, NOZZLE_Z } from "./enginePlume";
import { assetUrl } from "../../utils/assetUrl";

// Per-second physics constants (converted from the old per-frame@60fps values)
const ACCEL = 25.2;         // was 0.007/frame
const MAX_SPEED = SHIP_MAX_SPEED; // was 0.18/frame
const WARP_SPEED = SHIP_WARP_SPEED; // was 0.65/frame
const TURN_SPEED = 2.4;     // rad/s, was 0.04/frame
const SPACE_DRAG = 0.982;   // per-frame decay basis
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

/**
 * Breaking orbit puts the ship this far past the body's proximity zone, so it
 * leaves both the lock radius and the "fly closer" tooltip radius. Planets
 * drift ~1.8 u/s, so the margin also outlasts the 1.8s lock cooldown.
 */
const ESCAPE_MARGIN = 1.15;
/** Outward drift after breaking orbit, so the ship keeps opening the gap. */
const ESCAPE_SPEED = 4;

/**
 * Jump standoff for planets: inside the lock radius (1.3x size) and outside
 * the body, so the lock engages on the frame the ship arrives. Destinations
 * carry their own standoff (`jumpR`, src/data/destinations.ts).
 */
const JUMP_PLANET_FACTOR = 1.2;

/**
 * Nozzle exit centres in ship space: the GLB's Engine_Emissive clusters at
 * model (±0.582, -0.05, 3.25) with exit lips at z 3.5, scaled 0.35 and
 * turned π about Y.
 */

/** Chase-camera scratch vectors (no per-frame allocation). */
const _camTarget = new THREE.Vector3();
const _camSide = new THREE.Vector3();

/** Spawn point, and the first planet the ship faces there. */
const SPAWN = { x: 0, y: 0, z: 18 };
const FIRST_TARGET = planets[0];

// Collisions: big scenery asteroids + the sun (belt is decorative — excluded)
const COLLIDERS = [...ASTEROID_COLLIDERS, SUN_COLLIDER];

/**
 * Gravity wells, one per planet plus the sun, reused every frame: planet
 * entries are refreshed from `bodies`, and the active ones are copied to the
 * front of ACTIVE_WELLS so stepGravity takes a count instead of a fresh array.
 */
const PLANET_WELLS: Well[] = planets.map((p) => ({
  x: 0, y: 0, z: 0, g: PLANET_WELL_G, radius: p.size * PLANET_WELL_RADIUS_FACTOR, rMin: p.size,
}));
/** Well radius by planet name, for the per-frame escape-grace check. */
const WELL_RADIUS_BY_NAME = new Map(planets.map((p, i) => [p.name, PLANET_WELLS[i].radius]));
const SUN_WELL: Well = { x: SUN_COLLIDER.x, y: SUN_COLLIDER.y, z: SUN_COLLIDER.z, g: SUN_WELL_G, radius: SUN_WELL_RADIUS, rMin: SUN_COLLIDER.r };
const ACTIVE_WELLS: Well[] = Array.from({ length: planets.length + 1 }, () => ({ ...SUN_WELL }));
const slingshotLines = new ChatterScheduler(chatterPools);
/**
 * The engine material's original emissive colour, captured the first time the
 * cached GLTF material is seen. A remount (classic-résumé round trip) with a
 * non-stock plume must not capture the tint as "stock".
 */
const stockEmissive = new WeakMap<THREE.Material, THREE.Color>();
const PLUME_NOZZLE_R = 0.07;

/** Spark base colour for the current plume (written on plume change, read by the spark loop). */
const sparkRGB: [number, number, number] = [0.55, 1, 1];
/** SlingshotWatch result scratch. */
const slingshotOut = { whoosh: false, line: false };
/** Total velocity (pilot + gravity) scratch. */
const _total = new THREE.Vector3();

export default function Spaceship() {
  const { scene } = useGLTF(assetUrl("/models/spaceship.glb"));
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
  const engineStockEmissive = useMemo(() => {
    if (!engineMat) return new THREE.Color("#00f0ff");
    if (!stockEmissive.has(engineMat)) stockEmissive.set(engineMat, engineMat.emissive.clone());
    return stockEmissive.get(engineMat)!;
  }, [engineMat]);

  const pos = useRef(new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z));
  const vel = useRef(new THREE.Vector3(0, 0, 0)); // units/second
  // Gravity momentum (spec §5): built by wells, decays slowly; the ship moves
  // by vel + gravity. Zeroed wherever the ship is placed, docked or bounced.
  const gravity = useRef({ x: 0, y: 0, z: 0 });
  const idleFor = useRef(0);
  const escapeGrace = useRef(new EscapeGrace());
  /** Well exits -> whoosh and slingshot callout (gravityWell.ts). */
  const slingshotWatch = useRef(new SlingshotWatch());
  const zeroGravity = () => { gravity.current.x = 0; gravity.current.y = 0; gravity.current.z = 0; };

  // Dev-only: e2e probes and the QA checklist need to reposition the ship.
  // `flight` cannot be used for this — it is written FROM pos every frame, so
  // assigning to it is a no-op. Registering here is the only way to reach pos.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.teleport = (x: number, y: number, z: number) => {
      pos.current.set(x, y, z);
      vel.current.set(0, 0, 0);
      zeroGravity();
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
    return () => { fitzDebug.teleport = null; fitzDebug.setAttitude = null; fitzDebug.gravity = null; fitzDebug.beam = null; };
  }, []);

  // Spawn nose-on to the first planet, so the first W press flies toward a
  // project rather than into empty space. bodies[] is seeded at t=0 at import.
  const angle = useRef(
    FIRST_TARGET
      ? headingToward(SPAWN.x, SPAWN.z, bodies[FIRST_TARGET.name].x, bodies[FIRST_TARGET.name].z)
      : 0
  );
  const roll = useRef(0);
  const pitch = useRef(0);
  const turnVelocity = useRef(0); // rad/second
  const pitchVel = useRef(0); // rad/s — `pitch` ref (above) is now flight state, not just visual
  const shake = useRef(0);
  const lastImpactAt = useRef(-1);
  const warpSuppressUntil = useRef(-1);
  // False until the pilot's first input. Until then the parked ship keeps its
  // nose on an intercept course, so the first W press flies into a planet.
  const hasFlown = useRef(false);
  // A requested jump target, applied by the frame loop. Held in a ref rather
  // than applied in the store subscription: an open dossier freezes the frame
  // loop, so the jump first breaks orbit and lands on the next live frame.
  const pendingJump = useRef<string | null>(null);
  const snapCamera = useRef(false);
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
  /** Closest a docked ship may sit to the body's centre (0 = no limit, e.g. the portal). */
  const dockMinRadius = useRef(0);
  const escapeRadius = useRef(10);
  const orbitRadius = useRef(6); // eased ring radius — starts at arrival distance, eases toward targetLockRadius
  const orbitAngle = useRef(0);

  const prevOrbitLocked = useRef(false);
  const lockedZone = useRef<string | null>(null);
  useEffect(() => {
    const wasLocked = prevOrbitLocked.current;
    prevOrbitLocked.current = isOrbitLocked;

    if (!wasLocked && isOrbitLocked) {
      // Lock entry: resolve the locked body and start the orbit from wherever
      // the ship arrived (no snap).
      zeroGravity();
      escapeGrace.current.clear();
      const activeZone = useSpaceStore.getState().activeZone;
      lockedZone.current = activeZone;
      const planet = activeZone ? planets.find((p) => p.name === activeZone) : undefined;
      const dest = destinationById(activeZone);
      if (planet) {
        const b = bodies[planet.name];
        lockedCenter.current.set(b.x, b.y, b.z);
        targetLockRadius.current = planet.size * ORBIT_RADIUS_FACTOR;
        dockMinRadius.current = planet.size + CAPTURE_SURFACE_MARGIN;
        escapeRadius.current = planet.size * ZONE_FACTOR * ESCAPE_MARGIN;
      } else if (dest) {
        lockedCenter.current.set(dest.pos[0], dest.pos[1], dest.pos[2]);
        dockMinRadius.current = 0;
        targetLockRadius.current = dest.orbitR;
        escapeRadius.current = escapeR(dest);
      } else {
        // Shouldn't happen, but never crash: orbit in place.
        lockedCenter.current.copy(pos.current);
        dockMinRadius.current = 0;
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
    // Out along the body->ship line past the proximity zone, then drift
    // outward. The old fixed 2.8u push backwards along the nose left the ship
    // inside the lock radius, so a planet drifting toward it re-locked it.
    // The live body position is used: the lock centre was captured at entry.
    const zoneBody = bodies[lockedZone.current ?? ""];
    if (zoneBody) lockedCenter.current.set(zoneBody.x, zoneBody.y, zoneBody.z);
    const out = escapePosition(pos.current, lockedCenter.current, escapeRadius.current);
    pos.current.set(out.x, out.y, out.z);
    vel.current.subVectors(pos.current, lockedCenter.current).setLength(ESCAPE_SPEED);
    zeroGravity();
    // The escape push leaves the ship inside this planet's well; skip its pull
    // until the ship is clear, or it would be dragged straight back into lock.
    const left = lockedZone.current;
    if (left && planets.some((p) => p.name === left)) escapeGrace.current.arm(left);
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
      const camDistance = warpActive ? 6.8 : 4.6 + 0.6 * speedNorm;
      const camHeight = warpActive ? 2.8 : 1.8;
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
      _camTarget.set(
        pos.current.x - nose.x * camDistance + _camSide.x,
        pos.current.y - nose.y * camDistance + camHeight + (orbiting && !rm ? 0.8 : 0),
        pos.current.z - nose.z * camDistance + _camSide.z
      );
      // A jump snaps the camera with the ship: easing across ~150u would swing
      // it through the sun, and is exactly the motion reduced motion avoids.
      const f = snapCamera.current ? 1 : frameLerp(orbiting ? 0.02 : 0.05, dt);
      snapCamera.current = false;
      state.camera.position.lerp(_camTarget, f);
      state.camera.lookAt(
        pos.current.x + nose.x * 1.5,
        pos.current.y + nose.y * 1.5 + 0.2,
        pos.current.z + nose.z * 1.5
      );
    };

    if (isOrbitLocked) {
      // The locked body orbits the sun — ride along with it (spec §1).
      const zone = store.activeZone;
      const live = zone ? bodies[zone] : undefined;
      if (live) lockedCenter.current.set(live.x, live.y, live.z);

      orbitRadius.current += (targetLockRadius.current - orbitRadius.current) * frameLerp(0.03, dt);
      // Continuing revolution is the involuntary, large-field motion reduced
      // motion targets — gate only this increment. The easings above/below
      // (radius settling, bank/level-out) still run so the ship glides to its
      // orbital station and settles rather than snapping or hanging mid-approach.
      if (!store.reducedMotion) orbitAngle.current += dt * 0.25;
      pos.current.x = lockedCenter.current.x + Math.sin(orbitAngle.current) * orbitRadius.current;
      pos.current.z = lockedCenter.current.z + Math.cos(orbitAngle.current) * orbitRadius.current;
      pos.current.y += (lockedCenter.current.y - pos.current.y) * frameLerp(0.04, dt);
      // Settling into orbit must not dip the ship toward the surface (utils/capture.ts).
      if (dockMinRadius.current > 0) keepOutside(pos.current, lockedCenter.current, dockMinRadius.current);
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
      beamState.active = false; beamState.reel.active = false;
      applyChaseCam(false, true);
      return;
    }

    // Jump: drop in nose-on at the target's lock standoff. SpacePlanets runs
    // after this component each frame, so the lock (and dossier) engage on
    // this same frame. The post-break cooldown would block that, so clear it.
    if (pendingJump.current) {
      const id = pendingJump.current;
      pendingJump.current = null;
      const planet = planets.find((p) => p.name === id);
      const dest = planet ? undefined : destinationById(id);
      const target = planet ? bodies[planet.name] : dest && { x: dest.pos[0], y: dest.pos[1], z: dest.pos[2] };
      const standoff = planet ? planet.size * JUMP_PLANET_FACTOR : dest?.jumpR;
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
        useSpaceStore.setState({ isOrbitCooldown: false });
        store.triggerTeleportFlash();
      }
    }

    // 0. Pre-flight auto-aim. A visitor reads the spawn banner for a while
    // before touching anything, and the planets drift meanwhile, so a heading
    // fixed at spawn goes stale. Track an intercept (with orbital lead) until
    // the first input, then hand over and never touch the controls again.
    if (!hasFlown.current) {
      const touched = input.forward || input.backward || input.left || input.right
        || input.ascend || input.descend || input.boost || input.beam || input.steer !== 0 || input.thrust !== 0;
      // Leaving the spawn pad by any other route (a dev/e2e teleport, a
      // collision push) also ends the auto-aim: it only exists to point a
      // parked, untouched ship at a planet.
      if (touched || !store.isNearSpawn) {
        hasFlown.current = true;
        flight.hasFlown = true;
      } else {
        const aim = interceptAim(pos.current, planets, ambient, MAX_SPEED, COLLIDERS, !store.reducedMotion);
        if (aim) {
          const k = frameLerp(0.04, dt);
          // Shortest way round, so the nose never spins the long way.
          const dYaw = Math.atan2(Math.sin(aim.yaw - angle.current), Math.cos(aim.yaw - angle.current));
          angle.current += dYaw * k;
          pitch.current += (aim.pitch - pitch.current) * k;
        }
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
    // empty tank drains nothing and simply cruises.
    //
    // Running dry is a graceful coast, not a stop: the warp branch below assigns
    // velocity directly, so when it stops running the ship keeps its 39 u/s and
    // decays through the existing SPACE_DRAG.
    const warpActive = input.boost && time > warpSuppressUntil.current && flight.fuel > 0;
    if (warpActive) flight.fuel = drainFuel(flight.fuel, dt);
    store.setFuelEmpty(flight.fuel <= 0);
    store.setWarping(warpActive);
    const thrustInput = input.forward ? 1 : Math.max(0, input.thrust);
    const braking = input.backward || input.thrust < -0.2;

    const nose = noseDirection(angle.current, pitch.current);

    // Tractor beam (spec §6): off in warp; the nose is its origin and axis.
    beamState.active = input.beam && !warpActive;
    beamState.ox = pos.current.x + nose.x * 1.3; beamState.oy = pos.current.y + nose.y * 1.3; beamState.oz = pos.current.z + nose.z * 1.3;
    beamState.dx = nose.x; beamState.dy = nose.y; beamState.dz = nose.z;
    if (!beamState.active) beamState.oreStreak = 0;

    // Caps sit before the drag below; cruiseCap keeps the post-drag speed the
    // same at every frame rate (the tuning targets are measured at 60 fps).
    if (warpActive) {
      const warp = cruiseCap(WARP_SPEED, SPACE_DRAG, dt);
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
    const grace = escapeGrace.current;
    if (grace.skip) {
      const gb = bodies[grace.skip];
      const gr = WELL_RADIUS_BY_NAME.get(grace.skip);
      if (gb && gr !== undefined) grace.update(toroidalDistance3(pos.current.x, pos.current.z, pos.current.y, gb.x, gb.z, gb.y, COSMIC_BOUNDS), gr);
      else grace.clear();
    }
    let wellCount = 0;
    for (let i = 0; i < planets.length; i++) {
      if (planets[i].name === grace.skip) continue;
      const b = bodies[planets[i].name], src = PLANET_WELLS[i], dst = ACTIVE_WELLS[wellCount++];
      dst.x = b.x; dst.y = b.y; dst.z = b.z; dst.g = src.g; dst.radius = src.radius; dst.rMin = src.rMin;
    }
    const sunDst = ACTIVE_WELLS[wellCount++];
    sunDst.x = SUN_WELL.x; sunDst.y = SUN_WELL.y; sunDst.z = SUN_WELL.z;
    sunDst.g = SUN_WELL.g; sunDst.radius = SUN_WELL.radius; sunDst.rMin = SUN_WELL.rMin;
    const g = gravity.current;
    stepGravity(g, pos.current, vel.current, ACTIVE_WELLS, wellCount, gravityMode(hasFlown.current, warpActive, idleFor.current), dt);

    pos.current.x += (vel.current.x + g.x) * dt;
    pos.current.y += (vel.current.y + g.y) * dt;
    pos.current.z += (vel.current.z + g.z) * dt;

    // Ecliptic-departure advisory (flavor only — nothing pulls the ship back)
    store.setAltitudeWarn(Math.abs(pos.current.y) > 180);

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
        zeroGravity(); // momentum into the sun would just hit it again
        warpSuppressUntil.current = time + 0.45; // let the reflection push us away
        if (time - lastImpactAt.current > 0.5) {
          lastImpactAt.current = time;
          shake.current = 0.5;
          soundManager.impact();
          store.bumpImpact();
        }
        break;
      }
    }

    _total.set(vel.current.x + gravity.current.x, vel.current.y + gravity.current.y, vel.current.z + gravity.current.z);
    const totalSpeed = _total.length();
    beamState.vel.x = _total.x; beamState.vel.y = _total.y; beamState.vel.z = _total.z;

    // Which planet well the ship is in now; leaving one fast is a slingshot.
    let wellNow: string | null = null;
    for (let i = 0; i < planets.length; i++) {
      const b = bodies[planets[i].name];
      if (toroidalDistance3(pos.current.x, pos.current.z, pos.current.y, b.x, b.z, b.y, COSMIC_BOUNDS) < PLANET_WELLS[i].radius) { wellNow = planets[i].name; break; }
    }
    const sling = slingshotWatch.current.update(
      time, store.broadcast?.id ?? 0, wellNow, totalSpeed,
      Math.hypot(gravity.current.x, gravity.current.y, gravity.current.z), warpActive,
      store.race.phase === "running", slingshotOut);
    if (sling.whoosh) soundManager.whoosh();
    if (sling.whoosh) store.recordBadge("slingshot"); // logbook: Slingshot
    if (sling.line) store.sendBroadcast(slingshotLines.pick("slingshot"), { silent: true });

    // Toroidal boundary wrap — all three axes (spec §2). Exactly one period, so
    // it agrees with utils/toroidal.ts, and silent: it happens inside the edge
    // haze (EdgeHaze.tsx), so there is no flash, zap or radio line any more.
    const wx = wrapCoord(pos.current.x), wy = wrapCoord(pos.current.y), wz = wrapCoord(pos.current.z);
    if (wx !== pos.current.x || wy !== pos.current.y || wz !== pos.current.z) {
      state.camera.position.x += wx - pos.current.x;
      state.camera.position.y += wy - pos.current.y;
      state.camera.position.z += wz - pos.current.z;
      pos.current.set(wx, wy, wz);
    }

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
      const targetBurn = (warpActive ? 4.5 : 0.7) * (0.94 + Math.sin(time * 23) * 0.06);
      engineMat.emissiveIntensity = THREE.MathUtils.lerp(engineMat.emissiveIntensity, targetBurn, frameLerp(0.3, dt));
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
    if (shake.current > 0.001 && !useSpaceStore.getState().reducedMotion) {
      state.camera.position.x += (Math.random() - 0.5) * shake.current;
      state.camera.position.y += (Math.random() - 0.5) * shake.current;
      state.camera.position.z += (Math.random() - 0.5) * shake.current;
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
    store.setNearSpawn(Math.abs(pos.current.x) < 0.6 && Math.abs(pos.current.z - 18) < 0.6 && Math.abs(pos.current.y) < 3);
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
