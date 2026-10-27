import { useRef, useMemo, useEffect, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import EngineWake from "./EngineWake";
import { useModel } from "../../utils/sceneAssets";
import { flight, useSpaceStore, bodies, worldEventElapsed, selectRaceFlying } from "../../store/spaceStore";
import { convoyShipOffsetAt, CONVOY_HIDE_DIST } from "../../utils/worldEvents";
import { ambientTime, gameTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { dampVec } from "../../utils/reactions";
import { cargoSwerveTarget, curvatureRoll, HailGate, CARGO_REACT_RADIUS, RADIO_BUSY_S } from "../../utils/cargoReaction";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { fitzDebug } from "../../debug/bridge";
import { glowScale } from "../../utils/sunLight";

/** The wake narrows to nothing at its oldest point. */
const wakeTaper = (t: number) => t * t;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Three trade loops threading the volume: a climbing run (−80 → +110 with a
// return dive), a belt-gap weaver, and a high ring at portal altitude (spec §5).
const ROUTES = [
  [v(-110, -80, 80), v(-20, -30, 150), v(130, 20, -40), v(30, 65, -170), v(-140, 110, -70)],
  [v(150, -40, 60), v(60, 10, 180), v(-160, -25, 140), v(-90, 30, -30), v(40, -10, -120)],
  [v(0, 95, -200), v(170, 80, -100), v(200, 60, 80), v(0, 110, 120), v(-190, 90, -20)],
].map((pts) => new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5));

interface ShipDef { route: number; phase: number; loopSeconds: number }
const SHIPS: ShipDef[] = [
  { route: 0, phase: 0.0, loopSeconds: 110 },
  { route: 0, phase: 0.5, loopSeconds: 110 },
  { route: 1, phase: 0.2, loopSeconds: 140 },
  { route: 1, phase: 0.7, loopSeconds: 140 },
  { route: 2, phase: 0.4, loopSeconds: 90 },
];

const lookTarget = new THREE.Vector3();
const tanA = new THREE.Vector3();
const tanB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const right = new THREE.Vector3();
const swerveTarget = { x: 0, y: 0, z: 0 };
/** Spec: swerve in over ~1s, settle back over ~3s (half-lives). */
const SWERVE_IN_HALFLIFE = 0.25;
const SWERVE_OUT_HALFLIFE = 0.75;
/** Roll (rad) per unit/s of sideways swerve velocity, so the slide reads as piloted. */
const SWERVE_ROLL = 0.08;
const hailLines = new ChatterScheduler(chatterPools);
const convoyOff = new THREE.Vector3();
const convoyAhead = new THREE.Vector3();

/** Clones the cargo model into a steerable wrapper; nav/engine materials are cloned so each blinks on its own phase. */
function buildShip(scene: THREE.Object3D, name: string) {
  const model = scene.clone(true);
  // glTF export maps the ship's Blender +Y nose to -Z, but Object3D.lookAt
  // points +Z at the target — flip the model inside a wrapper we steer.
  model.rotation.y = Math.PI;
  const group = new THREE.Group();
  group.add(model);
  group.name = name;
  const navMats: THREE.MeshStandardMaterial[] = [];
  const engineMats: THREE.MeshStandardMaterial[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.name === "NavRed" || m.name === "NavGreen") {
        const c = m.clone();
        o.material = c;
        navMats.push(c);
      } else if (m.name === "EngineGlow") {
        const c = m.clone();
        o.material = c;
        engineMats.push(c);
      }
    }
  });
  const dish = model.getObjectByName("RadarDish") ?? null;
  const trailTarget: RefObject<THREE.Object3D> = { current: group };
  return { group, navMats, engineMats, dish, trailTarget };
}

export default function CargoTraffic() {
  const { scene } = useModel(assetUrl("/models/cargo_ship.glb"));
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const count = isLowPerf ? 3 : 5;
  const rolls = useRef<number[]>(SHIPS.map(() => 0));

  const offsets = useMemo(() => SHIPS.map(() => new THREE.Vector3()), []);
  const hailGate = useMemo(() => new HailGate(SHIPS.length), []);
  // When the last broadcast landed, so a hail never talks over it.
  const lastBroadcast = useRef({ id: 0, at: -Infinity });

  // Mirrored onto the bridge purely so the e2e probe can read it.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.cargoSwerve = offsets;
    return () => { fitzDebug.cargoSwerve = null; };
  }, [offsets]);

  // Clone the small ship per NPC; clone nav-light materials so each blinks with its own phase.
  const ships = useMemo(() => SHIPS.map((_, i) => buildShip(scene, `CargoShip${i}`)), [scene]);
  // World-event convoy (spec: cargo convoy): always mounted, hidden until an event.
  const convoy = useMemo(() => [0, 1, 2].map((i) => {
    const s = buildShip(scene, `ConvoyShip${i}`);
    s.group.visible = false; // never flashes at the origin before its first frame
    return s;
  }), [scene]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const elapsed = state.clock.getElapsedTime();
    const time = ambientTime(elapsed);
    const now = gameTime(elapsed);
    const store = useSpaceStore.getState();
    const react = !store.reducedMotion;
    const raceRunning = selectRaceFlying(store);
    const broadcastId = store.broadcast?.id ?? 0;
    if (broadcastId !== lastBroadcast.current.id) lastBroadcast.current = { id: broadcastId, at: now };
    const radioBusy = now - lastBroadcast.current.at < RADIO_BUSY_S;
    // Nav lights and engines are self-lit: held at their 1 AU glow far out.
    const glowK = glowScale.value;
    for (let i = 0; i < count; i++) {
      const def = SHIPS[i];
      const ship = ships[i];
      const curve = ROUTES[def.route];
      // Route progress with a gentle speed wobble. `time / loopSeconds` alone is
      // pure linear arc-length travel — perfectly constant velocity forever,
      // which is the classic tell of a scripted path and made the traffic read
      // as mechanical rather than piloted. Two slow sines at incommensurate
      // periods (~52s and ~23s), phase-offset per ship by `i`, so no two ships
      // share a rhythm and the pattern never visibly repeats.
      //
      // Amplitudes are bounded so progress stays monotonic — a ship sliding
      // backwards along its spline would read as broken, not alive. The drift's
      // max derivative is 0.010*0.12 + 0.005*0.27 = 0.00255, against a base rate
      // of 1/loopSeconds. Worst case is the slowest route (140s): 0.00714 -
      // 0.00255 = +0.0046, still forward. Raising either amplitude past ~0.028
      // combined would break that on the 140s route.
      const drift = (Math.sin(time * 0.12 + i * 1.7) * 0.010 + Math.sin(time * 0.27 + i * 0.9) * 0.005);
      const t = (time / def.loopSeconds + def.phase + drift) % 1;

      const pos = ship.group.position;
      curve.getPointAt(t, pos);
      curve.getTangentAt(t, tanA);
      const dist = Math.hypot(pos.x - flight.x, pos.y - flight.y, pos.z - flight.z);

      // Swerve: an eased sideways offset on top of the route, never a route change.
      const off = offsets[i];
      const prevX = off.x, prevY = off.y, prevZ = off.z;
      if (react) {
        cargoSwerveTarget(swerveTarget, pos, tanA, flight);
        const swerving = swerveTarget.x !== 0 || swerveTarget.y !== 0 || swerveTarget.z !== 0;
        dampVec(off, swerveTarget, swerving ? SWERVE_IN_HALFLIFE : SWERVE_OUT_HALFLIFE, dt);
      }
      // Hails are text, not motion: they run under reduced motion too.
      if (hailGate.update(i, dist, now, raceRunning, radioBusy)) store.sendBroadcast(hailLines.pick("hail"), { silent: true });

      pos.y += Math.sin(time * 0.6 + i * 2.1) * 0.35;
      pos.add(off);
      curve.getPointAt((t + 0.003) % 1, lookTarget);
      lookTarget.add(off);
      ship.group.lookAt(lookTarget);

      // Banking: bank into the route's curvature (curvatureRoll explains the sign), plus into the swerve's slide.
      right.crossVectors(tanA, UP).normalize();
      const lateral = dt > 0
        ? ((off.x - prevX) * right.x + (off.y - prevY) * right.y + (off.z - prevZ) * right.z) / dt
        : 0;
      curve.getTangentAt((t + 0.01) % 1, tanB);
      let targetRoll = curvatureRoll(tanA, tanB);
      targetRoll += THREE.MathUtils.clamp(lateral * SWERVE_ROLL, -0.6, 0.6);
      rolls.current[i] += (targetRoll - rolls.current[i]) * (1 - Math.pow(0.01, dt));
      ship.group.rotateZ(rolls.current[i]);

      // Nav lights: a slow blink, or a rapid alert flash while the player is close.
      const blink = dist < CARGO_REACT_RADIUS
        ? (Math.sin(time * 14 + i) > 0 ? 6 : 0.4)
        : (Math.sin(time * 3 + i * 1.7) > 0.82 ? 4.5 : 0.3);
      for (const m of ship.navMats) m.emissiveIntensity = blink * glowK;

      // Engine burn: uneven thruster flicker, per-ship phase
      const burn = 2.6 + Math.sin(time * 7.3 + i * 2.3) * 0.6 + Math.sin(time * 13.7 + i) * 0.3;
      for (const m of ship.engineMats) m.emissiveIntensity = burn * glowK;

      // Radar dish: constant spin, on the ambient clock like everything else
      // in this loop (dt would keep it spinning under reduced motion).
      if (ship.dish) ship.dish.rotation.z = time * 1.2;
    }

    // World-event convoy: a planet-relative V formation riding the target's live position.
    const convoyElapsed = worldEventElapsed("convoy");
    const convoyEv = store.worldEvent?.convoy;
    const convoyCount = isLowPerf ? 1 : 3;
    for (let k = 0; k < convoy.length; k++) {
      const ship = convoy[k];
      if (convoyElapsed === null || !convoyEv || k >= convoyCount) { ship.group.visible = false; continue; }
      const c = bodies[convoyEv.planet];
      const slot = k as 0 | 1 | 2;
      convoyShipOffsetAt(convoyOff, convoyEv.plan, convoyElapsed, slot);
      if (convoyOff.length() > CONVOY_HIDE_DIST) { ship.group.visible = false; continue; }
      ship.group.visible = true;
      ship.group.position.set(c.x + convoyOff.x, c.y + convoyOff.y, c.z + convoyOff.z);
      convoyShipOffsetAt(convoyAhead, convoyEv.plan, convoyElapsed + 0.1, slot);
      lookTarget.set(c.x + convoyAhead.x, c.y + convoyAhead.y, c.z + convoyAhead.z);
      ship.group.lookAt(lookTarget);
      const blink = Math.sin(time * 3 + k * 1.7) > 0.82 ? 4.5 : 0.3;
      for (const m of ship.navMats) m.emissiveIntensity = blink * glowK;
      const burn = 2.6 + Math.sin(time * 7.3 + k * 2.3) * 0.6;
      for (const m of ship.engineMats) m.emissiveIntensity = burn * glowK;
    }
  });

  return (
    <>
      {ships.slice(0, count).map((s, i) => (
        <primitive key={i} object={s.group} scale={1.6} />
      ))}
      {convoy.map((s, i) => (
        <primitive key={`c${i}`} object={s.group} scale={1.6} />
      ))}
      {/* Faint engine wake, gated off in low-perf mode */}
      {!isLowPerf &&
        ships.slice(0, count).map((s, i) => (
          <EngineWake key={`t${i}`} target={s.trailTarget} width={1.1} length={3.5} color="#7fd8ff" attenuation={wakeTaper} />
        ))}
    </>
  );
}
