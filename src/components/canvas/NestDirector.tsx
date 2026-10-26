import { useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useSpaceStore, flight, combat } from "../../store/spaceStore";
import { shipTeleport } from "../../store/shipTeleport";
import { NEST_CENTRE } from "../../data/nest";
import { soundManager } from "../../audio/soundManager";
import { fitzDebug } from "../../debug/bridge";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";
import {
  createNestEvents, debugClearAll, debugClearWave, debugFormation, debugStartWave, stepNest, type NestInput,
} from "../../utils/combat/nest";
import {
  applyNestEvents, createShipTrack, maybeRumour, noseFrom, takeClick, trackShip, type NestEffects,
} from "../../utils/combat/director";
import { nestPaused } from "../../utils/combat/nestRadio";
import { saucerMuzzleWorld, tardigradeMouthWorld } from "../../utils/combat/monsterFrame";
import type { NestSink, V3 } from "../../utils/combat/types";
import { MONSTER_UNIFORMS } from "../../utils/monsters/monsterShading";
import type { SaucerRig } from "../../utils/monsters/saucerMaterial";
import type { TardigradeRig } from "../../utils/monsters/tardigradeMaterial";
import saucerRigJson from "../../data/saucerRig.json";
import tardigradeRigJson from "../../data/tardigradeRig.json";

const SAUCER_RIG = saucerRigJson as SaucerRig;
const TARDIGRADE_RIG = tardigradeRigJson as TardigradeRig;

/** Where the monsters' cannons and mouths are, from the rigs (built once). */
const SINK: NestSink = {
  muzzle: (s, o) => saucerMuzzleWorld(s, SAUCER_RIG, o),
  mouth: (t, o) => tardigradeMouthWorld(t, TARDIGRADE_RIG, o),
};

const CENTRE: V3 = { x: NEST_CENTRE[0], y: NEST_CENTRE[1], z: NEST_CENTRE[2] };

// ── Reused every frame (the loop allocates nothing) ────────────────────────
const ev = createNestEvents();
const track = createShipTrack();
const clickAim: V3 = { x: 0, y: 0, z: 0 };
const inp: NestInput = {
  ship: { x: flight.x, y: flight.y, z: flight.z }, shipVel: { x: 0, y: 0, z: 0 }, nose: { x: 0, y: 0, z: 1 },
  centre: CENTRE, racing: false, paused: false, lowPerf: false, warm: false, fireHeld: false, click: null,
};
/** The rumour plays once per page visit. */
const rumour = { told: false };

const FX: NestEffects = {
  zap: () => soundManager.zap(),
  plasmaShot: () => soundManager.plasmaShot(),
  fanfare: () => soundManager.fanfare(),
  broadcast: (text, silent) => useSpaceStore.getState().sendBroadcast(text, { silent }),
  setInNest: (on) => useSpaceStore.getState().setInNest(on),
  setWave: (wave, contacts) => useSpaceStore.getState().setWave(wave, contacts),
  markHullBreach: (at) => useSpaceStore.getState().markHullBreach(at),
  markNestCleared: (at) => useSpaceStore.getState().markNestCleared(at),
};

/** The ship's place and nose into the step's input (from the telemetry Spaceship wrote this frame). */
function readShip(): void {
  inp.ship.x = flight.x; inp.ship.y = flight.y; inp.ship.z = flight.z;
  noseFrom(flight.heading, flight.pitch, inp.nose);
}

/**
 * The Nest's frame loop (spec 2026-10-27-combat), headless: mounted after
 * Spaceship so it reads this frame's telemetry. It runs the fight
 * (utils/combat/nest.ts stepNest) and turns its events into the HUD stamps,
 * sounds, radio lines and store marks (utils/combat/director.ts); Spaceship
 * reacts to `combat.hits` and `combat.towRequest`. Allocation-free.
 */
export default function NestDirector() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const n = combat.nest;
    fitzDebug.nest = {
      combat,
      startWave: (k) => { readShip(); debugStartWave(n, k, inp, Math.random, ev); },
      clearWave: () => debugClearWave(n, ev),
      clearAll: () => debugClearAll(n, ev),
      formation: () => { readShip(); debugFormation(n, inp.ship, inp.nose); },
      resume: () => { n.frozen = false; },
      setHull: (hp) => { n.hull.hp = hp; },
      motion: () => MONSTER_UNIFORMS.uMotion.value,
    };
    return () => { fitzDebug.nest = null; };
  }, []);

  useFrame((_, delta) => {
    const s = useSpaceStore.getState();
    // Spaceship moved the ship by the same clamped step.
    const dt = Math.min(delta, 0.05);
    readShip();
    // Zero on a teleport frame (a jump, the tow, the race grid, a debug teleport).
    trackShip(track, flight.x, flight.y, flight.z, shipTeleport.seq, dt, inp.shipVel);
    inp.racing = flight.racing;
    inp.paused = nestPaused(s);
    inp.lowPerf = s.isLowPerf;
    inp.warm = combat.warm;
    inp.fireHeld = flight.input.beam;
    inp.click = takeClick(combat, clickAim);
    stepNest(combat.nest, inp, dt, Math.random, SINK, ev);
    const nowMs = Date.now();
    applyNestEvents(combat, ev, FX, performance.now() / 1000, nowMs);

    const dist = Math.hypot(flight.x - CENTRE.x, flight.y - CENTRE.y, flight.z - CENTRE.z);
    const last = s.broadcast;
    const radioBusy = (last !== null && nowMs - last.at < RADIO_BUSY_S * 1000) || nowMs < s.logbookLineAt;
    if (!inp.paused) maybeRumour(rumour, dist, flight.racing, radioBusy, FX);
  });

  return null;
}
