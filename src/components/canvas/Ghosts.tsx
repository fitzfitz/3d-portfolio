import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useModel } from "../../utils/sceneAssets";
import * as THREE from "three";
import { useSpaceStore, flight } from "../../store/spaceStore";
import { assetUrl } from "../../utils/assetUrl";
import { PLUME_COLORS } from "../../data/plumeColors";
import { setScannable, removeScannable } from "../../utils/scannables";
import {
  liveSkyUrl, nearestGhosts, shipQuat, ghostRegistry, hudShowsRadio, writeRadarBlips,
  LIVE_SKY_NOTICE, MAX_GHOSTS, FADE_IN_MS, GHOST_LABEL, type GhostPose,
} from "../../utils/liveSky";
import { type ShipState } from "../../utils/liveSkyProtocol";
import { createShoutGate, shoutDue, shoutLine, makeWireChartCache } from "../../utils/charting";

/** Plays another pilot's shout-out at most once per SHOUT_HEAR_GAP_MS. */
const hearShout = createShoutGate();
import { LiveSkyConnection, type SocketLike } from "../../utils/liveSkyConnection";
import { raceLink } from "../../utils/raceLink";
import { onRaceServer } from "../../utils/raceController";
import { onLiveSkyHello, watchRaceJoin } from "../../utils/raceJoin";
import { makePlumeGeometry, makePlumeMaterial, plumeSpreadFor, PLUME_HALF_ANGLE_DEG, NOZZLE_Y, NOZZLE_Z } from "./enginePlume";
import { fitzDebug } from "../../debug/bridge";

/** RaceCourse's race-ghost wash strength. */
const GHOST_WASH = 0.55;
const GHOST_PLUME_LEN = 0.3;
const GHOST_NOZZLE_R = 0.07;
const GHOST_PLUME_POWER = 0.3;
const NONE: GhostPose[] = [];
/** This ship's pose for conn.tick, reused every frame. */
const me: ShipState = { p: [0, 0, 0], q: [0, 0, 0, 1], plume: "stock", ch: 0 };

interface Slot { group: THREE.Group; hull: THREE.MeshBasicMaterial; flame: THREE.ShaderMaterial; plume: string; scanId: string | null }

function makeSlot(shipScene: THREE.Object3D, flameGeometry: THREE.BufferGeometry, i: number): Slot {
  const stock = new THREE.Color(PLUME_COLORS.stock.hex);
  // RaceCourse's race-ghost material, parameter for parameter, so the two
  // share one already-compiled program. Colour and opacity are uniforms.
  const hull = new THREE.MeshBasicMaterial({
    color: stock.clone().multiplyScalar(GHOST_WASH),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false,
  });
  const model = shipScene.clone(true);
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = hull; });
  model.scale.setScalar(0.35);
  model.rotation.set(0, Math.PI, 0);
  model.position.set(0, -0.05, 0);
  const flame = makePlumeMaterial(i * 1.7, stock);
  flame.uniforms.uPower.value = GHOST_PLUME_POWER;
  flame.uniforms.uSpread.value = plumeSpreadFor(GHOST_PLUME_LEN, GHOST_NOZZLE_R, PLUME_HALF_ANGLE_DEG);
  const plume = new THREE.Mesh(flameGeometry, flame);
  plume.position.set(0, NOZZLE_Y, NOZZLE_Z - GHOST_PLUME_LEN / 2);
  plume.rotation.set(Math.PI / 2, 0, 0);
  plume.scale.set(1, GHOST_PLUME_LEN, 1);
  plume.frustumCulled = false;
  const group = new THREE.Group();
  group.name = `LiveGhost_${i}`;
  group.visible = false;
  group.add(model, plume);
  return { group, hull, flame, plume: "stock", scanId: null };
}

function releaseScan(slot: Slot) {
  if (!slot.scanId) return;
  removeScannable(slot.scanId);
  ghostRegistry.delete(slot.scanId);
  slot.scanId = null;
}

/**
 * Live sky (spec docs/archive/specs/2026-10-14-live-sky-design.md §4–§5):
 * other pilots flying now, as up to 8 pooled ghost ships. Drives the
 * connection per frame. Mounted only when the live sky URL is configured; the
 * canvas (and so this) unmounts on the classic résumé, which closes the socket.
 */
export default function Ghosts() {
  const { scene: shipScene } = useModel(assetUrl("/models/spaceship.glb"));
  const flameGeometry = useMemo(() => makePlumeGeometry(GHOST_NOZZLE_R), []);
  const slots = useMemo(
    () => Array.from({ length: MAX_GHOSTS }, (_, i) => makeSlot(shipScene, flameGeometry, i)),
    [shipScene, flameGeometry],
  );
  const conn = useMemo(() => new LiveSkyConnection({
    url: liveSkyUrl(),
    createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
    now: () => performance.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => window.clearTimeout(h as number),
    random: Math.random,
    onCharted: (cc) => { if (hearShout(Date.now())) useSpaceStore.getState().announceLogbook(shoutLine(cc)); },
    onRace: (m) => onRaceServer(m),
    // R10: a reload or reconnect mid-race rejoins with the stored token; a waiting join goes out.
    onHello: () => onLiveSkyHello(),
  }), []);
  const noticeQueued = useRef(false);
  const wireCharts = useRef(makeWireChartCache());
  const wanted = useRef(false);

  useEffect(() => () => {
    conn.dispose();
    for (const s of slots) { releaseScan(s); s.hull.dispose(); s.flame.dispose(); }
    writeRadarBlips(NONE);
    flameGeometry.dispose();
  }, [conn, slots, flameGeometry]);

  // The race talks through this connection (raceLink.ts sendRace). A join
  // waiting on the consent notice goes out when it plays (raceJoin.ts).
  useEffect(() => {
    raceLink.conn = conn;
    const unwatch = watchRaceJoin();
    return () => {
      unwatch();
      if (raceLink.conn === conn) raceLink.conn = null;
    };
  }, [conn]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.liveSky = conn;
    return () => { fitzDebug.liveSky = null; };
  }, [conn]);

  useEffect(() => {
    const onVisibility = () => conn.setVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [conn]);

  // Consent (spec §5): the ship becomes shareable once the notice has actually
  // reached the radio on screen, not merely been queued. Played while the HUD
  // is unmounted (photo mode), it does not count and is queued again later.
  useEffect(() => useSpaceStore.subscribe((s) => s.broadcast, (b) => {
    const st = useSpaceStore.getState();
    if (b?.text !== LIVE_SKY_NOTICE || st.liveSkySeen) return;
    if (hudShowsRadio(st)) st.setLiveSkySeen(true);
    else noticeQueued.current = false;
  }), []);

  useFrame((state) => {
    const s = useSpaceStore.getState();
    if (s.liveSky && flight.hasFlown && !s.liveSkySeen && !noticeQueued.current && hudShowsRadio(s)) {
      noticeQueued.current = true;
      s.announceLogbook(LIVE_SKY_NOTICE);
    }
    const want = s.liveSky && flight.hasFlown && (s.liveSkySeen || noticeQueued.current);
    if (want !== wanted.current) { wanted.current = want; conn.setWanted(want); }

    // Alone in the sky, poses still go out mid-race: the room signs rings against them.
    if (s.liveSkySeen && (conn.peers > 0 || conn.racing)) {
      me.p[0] = flight.x; me.p[1] = flight.y; me.p[2] = flight.z;
      shipQuat(flight.heading, flight.pitch, me.q);
      me.plume = s.plumeColor;
      me.ch = wireCharts.current(s.charted, s.legacyCartographer);
      if (conn.tick(me, shoutDue(s.chartShoutAt, Date.now()))) s.clearChartShout();
    }

    const all = conn.ghosts.size ? conn.ghosts.sample(performance.now(), s.reducedMotion ? 0 : FADE_IN_MS) : NONE;
    // The radar shows every pilot in the room; only the nearest are drawn as ships.
    writeRadarBlips(all);
    const poses = all === NONE ? NONE : nearestGhosts(flight, all, MAX_GHOSTS);
    const t = state.clock.getElapsedTime();
    // Pass 1: release every slot whose ghost changed or left, so pass 2 can
    // re-register an id that moved to another slot this frame.
    for (let i = 0; i < slots.length; i++) {
      const g = poses[i];
      if (!g || slots[i].scanId !== g.scanId) releaseScan(slots[i]);
    }
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const g = poses[i];
      if (!g) {
        if (slot.group.visible) slot.group.visible = false;
        continue;
      }
      slot.group.visible = true;
      slot.group.position.set(g.p[0], g.p[1], g.p[2]);
      slot.group.quaternion.set(g.q[0], g.q[1], g.q[2], g.q[3]);
      if (slot.plume !== g.plume) {
        slot.plume = g.plume;
        const hex = (PLUME_COLORS[g.plume] ?? PLUME_COLORS.stock).hex;
        slot.hull.color.set(hex).multiplyScalar(GHOST_WASH);
        (slot.flame.uniforms.uColor.value as THREE.Color).set(hex);
      }
      slot.hull.opacity = g.alpha;
      slot.flame.uniforms.uPower.value = GHOST_PLUME_POWER * g.alpha;
      slot.flame.uniforms.uTime.value = t;
      slot.scanId = g.scanId;
      ghostRegistry.set(slot.scanId, { cc: g.cc, ch: g.ch });
      setScannable(slot.scanId, g.p[0], g.p[1], g.p[2], GHOST_LABEL);
    }
  });

  return (
    <group name="LiveSky">
      {slots.map((s) => <primitive key={s.group.name} object={s.group} />)}
    </group>
  );
}
