import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useModel } from "../../utils/sceneAssets";
import { RACE_GATES, RING_GATES, RING_RADIUS } from "../../data/ringCourse";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { STORE_KEYS, safeGetString } from "../../store/persist";
import { sampleGhost, GHOST_HZ, type Ghost, type GhostSample, type Vec3 } from "../../utils/race";
import {
  ringsVisible, targetGate, racingView, raceHoldAt, ringToClaim, lapMsFromRun, ghostForUpload, fetchBestLap,
  RACE_START_SCAN_ID, RACE_START_LABEL, type RingClaim,
} from "../../utils/raceScene";
import { loadRun, type RaceView } from "../../utils/raceSession";
import { RACE_LIMIT_MS } from "../../utils/raceProtocol";
import { raceLink, sendRace } from "../../utils/raceLink";
import { watchRaceOver, leaveRace } from "../../utils/raceController";
import { beaconApiUrl } from "../../utils/apiBase";
import { soundManager } from "../../audio/soundManager";
import { setScannable, removeScannable } from "../../utils/scannables";
import { assetUrl } from "../../utils/assetUrl";
import { exposureCompensation } from "../../utils/sunLight";

const N = RACE_GATES.length;
/** The recording's cap: the race limit at GHOST_HZ, and a second. */
const MAX_SAMPLES = (RACE_LIMIT_MS / 1000 + 1) * GHOST_HZ;
/** A recording that starts later than this after GO (a reload mid-race) is partial: it is never uploaded. */
const REC_LATE_S = 1;

// Additive and untone-mapped: brightness is the colour's magnitude, and the
// lit ring clears the bloom threshold while the course outline stays faint.
// The rings are a navigation projection, like the guide lines (F3): the
// material colour carries the shared exposure compensation each frame, so
// the course reads the same near the sun (exposure ~0.2) as at 1 AU. The
// ghost ship's colour carries it too.
const AMBER = new THREE.Color("#ffb020");
const SKY = new THREE.Color("#7dd3fc");
const C_LIT = AMBER.clone().multiplyScalar(2.2);
/** The start gate while another ring is the one to fly through. */
const C_START = AMBER.clone().multiplyScalar(0.7);
const C_COURSE = SKY.clone().multiplyScalar(0.22);
const C_PASSED = SKY.clone().multiplyScalar(0.06);

const Z = new THREE.Vector3(0, 0, 1);
const dummy = new THREE.Object3D();
const QUATS = RACE_GATES.map((g) => new THREE.Quaternion().setFromUnitVectors(Z, new THREE.Vector3(g.n.x, g.n.y, g.n.z)));

/**
 * The lit ring: the target while racing, else the start gate (inviting a
 * join), or none once the pilot has finished.
 */
function litRing(v: RaceView): number | null {
  const t = targetGate(v);
  if (t !== null) return t;
  return v.phase === "running" ? null : 0;
}
function ringColor(v: RaceView, i: number): THREE.Color {
  if (i === litRing(v)) return C_LIT;
  // The start gate is always amber.
  if (i === 0) return C_START;
  // Rings already flown this lap fade out.
  if (v.phase === "running" && i < v.next) return C_PASSED;
  return C_COURSE;
}

/**
 * The ring race's scene: the start gate (always there, scannable), the
 * course's rings for racers, the grid and the flags the flight reads, ring
 * claims, the lap's path, and the best lap's replay in a solo race.
 *
 * The race itself is the server's (raceController.ts reduces its messages to
 * the view); this reads the view each frame and acts on it. Quiet when idle:
 * one amber ring.
 */
export default function RaceCourse() {
  const ghostRef = useRef<THREE.Group>(null);
  const prevPos = useRef<Vec3 | null>(null);
  /** The last ring claim sent (raceScene.ts ringToClaim): a ring is claimed again only if its stamp does not come. */
  const claimed = useRef<RingClaim>({ race: "", next: -1, at: 0 });
  /** This race's path, from GO to the finish. */
  const rec = useRef<{ race: string; samples: GhostSample[]; valid: boolean; done: boolean } | null>(null);
  /** The course's best lap, fetched once per race. */
  const best = useRef<{ race: string; lap: { timeMs: number; ghost: Ghost } | null } | null>(null);
  const wasHeld = useRef(false);
  const paintedFor = useRef("");

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

  // The ghost is the hero ship's own model, recoloured as a translucent wash
  // (Ghosts.tsx's live pilots use this material's exact parameters: one program).
  const { scene: shipScene } = useModel(assetUrl("/models/spaceship.glb"));
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
    const [x, y, z] = RING_GATES[0];
    setScannable(RACE_START_SCAN_ID, x, y, z, RACE_START_LABEL);
    // The classic CV mid-race: the pilot leaves (DNF).
    const unsub = useSpaceStore.subscribe((s) => s.showClassicCV, (open) => {
      if (open && racingView(useSpaceStore.getState().raceView)) leaveRace();
    });
    // The over: upload the run once, with the path if it is a new best. From
    // the store, not a frame: a hidden tab or a frozen scene runs none.
    const stopOver = watchRaceOver((v) => {
      const r = rec.current?.race === v.race && rec.current.valid ? rec.current : null;
      const lap = best.current?.race === v.race ? best.current.lap : null;
      // The best is unknown (the fetch is still out): the server keeps only a better path anyway.
      const bestMs = lap?.timeMs ?? Infinity;
      const run = loadRun(safeGetString(STORE_KEYS.raceRun), Date.now());
      return ghostForUpload(v.finished, lapMsFromRun(run?.race === v.race ? run : null), bestMs, r && { time: 0, samples: r.samples });
    });
    return () => {
      unsub();
      stopOver();
      removeScannable(RACE_START_SCAN_ID);
      flight.racing = false;
      flight.raceHold = false;
      if (raceLink.conn) raceLink.conn.racing = false;
    };
  }, []);

  useFrame(() => {
    const s = useSpaceStore.getState();
    const v = s.raceView;
    const now = Date.now();

    // The flags the flight, the beam, jumps and the live-sky link read.
    const racing = racingView(v);
    const held = raceHoldAt(v, now);
    flight.racing = racing;
    flight.raceHold = held;
    if (raceLink.conn) raceLink.conn.racing = racing;
    if (wasHeld.current && !held && racing) soundManager.chime(); // GO
    wasHeld.current = held;

    // The best lap: the time to beat, and the solo race's replay.
    if (racing && best.current?.race !== v.race) {
      const entry: { race: string; lap: { timeMs: number; ghost: Ghost } | null } = { race: v.race, lap: null };
      best.current = entry;
      void fetchBestLap(beaconApiUrl()).then((lap) => { entry.lap = lap; });
    }

    const cur = { x: flight.x, y: flight.y, z: flight.z };
    const prev = prevPos.current;
    prevPos.current = cur;

    // This lap's path, at GHOST_HZ from GO to the finish.
    if (racing && now >= v.goAt) {
      if (rec.current?.race !== v.race) {
        rec.current = { race: v.race, samples: [], valid: (now - v.goAt) / 1000 < REC_LATE_S, done: false };
      }
      const r = rec.current;
      const t = (now - v.goAt) / 1000;
      if (v.phase === "running" && v.finished) r.done = true;
      if (!r.done && r.samples.length < MAX_SAMPLES && t * GHOST_HZ >= r.samples.length) {
        r.samples.push({ x: cur.x, y: cur.y, z: cur.z, yaw: flight.heading, pitch: flight.pitch });
      }
    }

    // Ring claims: the server stamps the ring and the view moves on with it.
    if (prev && !held && !s.photoMode) {
      const i = ringToClaim(v, prev, cur, claimed.current, now);
      if (i !== null && v.phase === "running" && sendRace({ t: "rring", i })) {
        const c = claimed.current;
        c.race = v.race; c.next = i; c.at = now;
        if (i === N) {
          soundManager.fanfare();
          // Close the path on the finish line itself: the 10 Hz samples would
          // otherwise end up to a tenth of a second short.
          const r = rec.current;
          if (r && v.phase === "running" && r.race === v.race && !r.done) {
            r.samples.push({ x: cur.x, y: cur.y, z: cur.z, yaw: flight.heading, pitch: flight.pitch });
            r.done = true;
          }
        } else {
          soundManager.pickup();
        }
      }
    }

    // The best lap, replayed from GO in a solo race.
    const ghost = ghostRef.current;
    if (ghost) {
      const solo = v.phase === "running" && v.kind === "solo" ? v : null;
      const lap = solo && best.current?.race === solo.race ? best.current.lap : null;
      const pose = solo && lap ? sampleGhost(lap.ghost.samples, (now - solo.goAt) / 1000) : null;
      ghost.visible = !!pose;
      if (pose) {
        ghost.position.set(pose.x, pose.y, pose.z);
        ghost.rotation.set(-pose.pitch, pose.yaw, 0, "YXZ");
      }
    }

    // Rings: recolour only when the look changes; pulse the lit one. The
    // start gate always shows; the rest only to racers (ringsVisible).
    const visible = ringsVisible(v);
    const lit = litRing(v);
    const key = `${v.phase}:${v.phase === "running" ? `${v.next}:${v.finished}` : ""}`;
    if (key !== paintedFor.current) {
      paintedFor.current = key;
      for (let i = 0; i < N; i++) rings.setColorAt(i, ringColor(v, i));
      rings.instanceColor!.needsUpdate = true;
    }
    const pulse = s.reducedMotion ? 1 : 1 + Math.sin(now / 250) * 0.04;
    for (let i = 0; i < N; i++) {
      const g = RACE_GATES[i];
      dummy.position.set(g.c.x, g.c.y, g.c.z);
      dummy.quaternion.copy(QUATS[i]);
      dummy.scale.setScalar(i !== 0 && !visible ? 0 : i === lit ? pulse : 1);
      dummy.updateMatrix();
      rings.setMatrixAt(i, dummy.matrix);
    }
    rings.instanceMatrix.needsUpdate = true;
    // toneMapped: false, so only the composer's pass exposes the rings; the
    // shared value is 1 / exposure there and 1 in low-perf (sunLight.ts).
    // A uniform write: no recompile, no allocation.
    (rings.material as THREE.MeshBasicMaterial).color.setScalar(exposureCompensation.value);
    // The race ghost is toneMapped: false and additive too: same compensation,
    // on top of its 0.55 sky wash (allocation-free: SKY is read, not cloned).
    ghostMaterial.color.copy(SKY).multiplyScalar(0.55 * exposureCompensation.value);
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
