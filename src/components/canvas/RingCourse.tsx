import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { RACE_GATES, RING_GATES, RING_RADIUS, PAR_SECONDS } from "../../data/ringCourse";
import { flight, useSpaceStore } from "../../store/spaceStore";
import {
  raceStep, sampleGhost, encodeGhost, decodeGhost, formatRaceTime, isNewBest,
  GHOST_HZ, type Ghost, type GhostSample, type RaceEvent, type RaceState, type Vec3,
} from "../../utils/race";
import { raceClock } from "../../utils/raceClock";
import { soundManager } from "../../audio/soundManager";
import { setScannable, removeScannable } from "../../utils/scannables";
import { assetUrl } from "../../utils/assetUrl";

const N = RACE_GATES.length;
const GHOST_KEY = "fitz-race-ghost";
/** A lap this long has been abandoned; also caps the ghost recording (~3000 samples). */
const MAX_RUN_SECONDS = 300;
/** How long the finish result stays up before the course resets to idle. */
const FINISH_HOLD_SECONDS = 8;

// Additive and untone-mapped: brightness is the colour's magnitude, and the
// lit ring clears the bloom threshold while the course outline stays faint.
const AMBER = new THREE.Color("#ffb020");
const SKY = new THREE.Color("#7dd3fc");
const C_LIT = AMBER.clone().multiplyScalar(2.2);
const C_COURSE = SKY.clone().multiplyScalar(0.22);
const C_PASSED = SKY.clone().multiplyScalar(0.06);

const Z = new THREE.Vector3(0, 0, 1);
const dummy = new THREE.Object3D();
const QUATS = RACE_GATES.map((g) => new THREE.Quaternion().setFromUnitVectors(Z, new THREE.Vector3(g.n.x, g.n.y, g.n.z)));

function loadGhost(): Ghost | null {
  try { return decodeGhost(localStorage.getItem(GHOST_KEY)); } catch { return null; }
}
function saveGhost(g: Ghost) {
  try { localStorage.setItem(GHOST_KEY, encodeGhost(g)); } catch { /* storage full or blocked */ }
}

/** Which ring is lit for a given race state: the start ring when idle. */
function litRing(race: RaceState): number {
  return race.phase === "running" ? race.next : 0;
}
function ringColor(race: RaceState, i: number): THREE.Color {
  if (i === litRing(race)) return C_LIT;
  // Rings already flown this lap fade out; ring 0 is the finish, never "passed".
  if (race.phase === "running" && i !== 0 && (race.next === 0 || i < race.next)) return C_PASSED;
  return C_COURSE;
}

/**
 * Time-trial course: a loop of rings from the spawn pad out through the belt
 * and back. Flying through ring 0 starts the clock; the rings must be flown in
 * order; ring 0 again finishes. The best lap is replayed as a ghost ship.
 *
 * Entirely optional — nothing else in the portfolio waits on it — and quiet
 * when idle: one lit start ring and a faint outline of the course.
 */
export default function RingCourse() {
  const ghostRef = useRef<THREE.Group>(null);
  const prevPos = useRef<Vec3 | null>(null);
  const recording = useRef<GhostSample[]>([]);
  const bestGhost = useRef<Ghost | null>(null);
  const finishedAt = useRef(0);
  const paintedFor = useRef<string>("");

  // Built here rather than as JSX so the colour buffer exists before shader
  // warm-up: setColorAt() creating it on the first frame would flip the
  // material to its instance-colour variant and recompile mid-flight.
  const rings = useMemo(() => {
    const geometry = new THREE.TorusGeometry(RING_RADIUS, 0.16, 6, 48);
    const material = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, N);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    mesh.name = "RaceRings";
    mesh.frustumCulled = false; // ten rings spread across the system; one bound would be the whole course anyway
    return mesh;
  }, []);

  // The ghost is the hero ship's own model, recoloured as a translucent wash.
  const { scene: shipScene } = useGLTF(assetUrl("/models/spaceship.glb"));
  const ghostMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: SKY.clone().multiplyScalar(0.55),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false,
  }), []);
  const ghostModel = useMemo(() => {
    const c = shipScene.clone(true);
    c.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = ghostMaterial; });
    return c;
  }, [shipScene, ghostMaterial]);

  useEffect(() => () => {
    rings.geometry.dispose();
    (rings.material as THREE.Material).dispose();
    rings.dispose();
    ghostMaterial.dispose();
  }, [rings, ghostMaterial]);

  useEffect(() => {
    bestGhost.current = loadGhost();
    const [x, y, z] = RING_GATES[0];
    setScannable("time_trial", x, y, z, "TIME TRIAL GATE");
    // A jump teleports across the map; the lap is void.
    const unsub = useSpaceStore.subscribe((s) => s.jumpRequest, () => abort());
    return () => { unsub(); removeScannable("time_trial"); };
  }, []);

  function abort() {
    const s = useSpaceStore.getState();
    if (s.race.phase !== "running") return;
    s.setRace({ phase: "idle" });
    s.sendBroadcast("TIME TRIAL ABORTED // FLY THROUGH THE START RING TO GO AGAIN");
  }

  function onEvent(event: RaceEvent, next: RaceState) {
    const s = useSpaceStore.getState();
    if (event === "start") {
      recording.current = [];
      soundManager.chime();
      const ghost = bestGhost.current ? ` · GHOST ${formatRaceTime(bestGhost.current.time)} IN PURSUIT` : "";
      s.sendBroadcast(`TIME TRIAL // CLOCK RUNNING · ${N - 1} RINGS · PAR ${formatRaceTime(PAR_SECONDS)}${ghost}`);
    } else if (event === "gate") {
      soundManager.pickup();
    } else if (next.phase === "finished") {
      soundManager.fanfare();
      finishedAt.current = raceClock.now;
      const t = next.time;
      const best = s.raceBest;
      const par = t < PAR_SECONDS ? " · UNDER PAR" : "";
      if (isNewBest(t, best)) {
        s.setRaceBest(t);
        const ghost = { time: t, samples: recording.current };
        saveGhost(ghost);
        bestGhost.current = ghost;
        s.sendBroadcast(`LAP ${formatRaceTime(t)} // NEW BEST${par}`);
      } else {
        s.sendBroadcast(`LAP ${formatRaceTime(t)} // BEST ${formatRaceTime(best!)}${par}`);
      }
    }
  }

  useFrame((_, delta) => {
    raceClock.now += Math.min(delta, 0.05);
    const s = useSpaceStore.getState();
    const cur = { x: flight.x, y: flight.y, z: flight.z };
    const prev = prevPos.current;
    prevPos.current = cur;
    let race = s.race;

    if (race.phase === "running" && (s.isOrbitLocked || s.showClassicCV
      || raceClock.now - race.startClock > MAX_RUN_SECONDS)) {
      abort();
      race = useSpaceStore.getState().race;
    }
    if (prev && !s.isOrbitLocked && !s.showClassicCV) {
      const r = raceStep(race, prev, cur, raceClock.now, RACE_GATES, RING_RADIUS);
      if (r.event) {
        s.setRace(r.state);
        race = r.state;
        onEvent(r.event, r.state);
      }
    }
    if (race.phase === "finished" && raceClock.now - finishedAt.current > FINISH_HOLD_SECONDS) {
      s.setRace({ phase: "idle" });
      race = { phase: "idle" };
    }

    // Record this lap, and replay the best one alongside it.
    const ghost = ghostRef.current;
    if (race.phase === "running") {
      const t = raceClock.now - race.startClock;
      const rec = recording.current;
      if (t * GHOST_HZ >= rec.length) rec.push({ x: cur.x, y: cur.y, z: cur.z, yaw: flight.heading, pitch: flight.pitch });
      const pose = bestGhost.current ? sampleGhost(bestGhost.current.samples, t) : null;
      if (ghost) {
        ghost.visible = !!pose;
        if (pose) {
          ghost.position.set(pose.x, pose.y, pose.z);
          ghost.rotation.set(-pose.pitch, pose.yaw, 0, "YXZ");
        }
      }
    } else if (ghost) {
      ghost.visible = false;
    }

    // Rings: recolour only when the lit ring changes; pulse the lit one.
    const key = race.phase === "running" ? `r${race.next}` : race.phase;
    if (key !== paintedFor.current) {
      paintedFor.current = key;
      for (let i = 0; i < N; i++) rings.setColorAt(i, ringColor(race, i));
      rings.instanceColor!.needsUpdate = true;
    }
    const lit = litRing(race);
    const pulse = s.reducedMotion ? 1 : 1 + Math.sin(raceClock.now * 4) * 0.04;
    for (let i = 0; i < N; i++) {
      const g = RACE_GATES[i];
      dummy.position.set(g.c.x, g.c.y, g.c.z);
      dummy.quaternion.copy(QUATS[i]);
      dummy.scale.setScalar(i === lit ? pulse : 1);
      dummy.updateMatrix();
      rings.setMatrixAt(i, dummy.matrix);
    }
    rings.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={rings} />
      <group ref={ghostRef} name="RaceGhost" visible={false}>
        <primitive object={ghostModel} scale={0.35} rotation={[0, Math.PI, 0]} position={[0, -0.05, 0]} />
      </group>
    </>
  );
}
