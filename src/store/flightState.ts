import { SPAWN } from "../data/spawn";
import { FUEL_MAX } from "../utils/fuel";
import { START_GATE } from "../data/ringCourse";
import { gridSlot } from "../utils/race";
import { raceLinkCode } from "../utils/flightGate";

/**
 * Where the ship starts: the spawn pad, or, for a `?race=CODE` invite link,
 * grid slot 0 behind the race's start gate, facing it (the visitor is joining
 * that race). `heading` null: Spaceship aims a spawn-pad ship at the first probe.
 */
export interface StartPose { x: number; y: number; z: number; heading: number | null; pitch: number; race: boolean }

export function startPose(search: string): StartPose {
  if (raceLinkCode({ search }) === null) return { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, heading: null, pitch: 0, race: false };
  const g = gridSlot(START_GATE, 0);
  return { x: g.p.x, y: g.p.y, z: g.p.z, heading: g.heading, pitch: g.pitch, race: true };
}

/** This page's start, read once at import (raceJoin.ts drops the code from the URL later). */
const START = startPose(typeof window !== "undefined" ? window.location.search : "");
let started = false;

/**
 * The pose the ship is first placed at: START for the page's first ship, the
 * spawn pad for any later one (the canvas remounts after the classic résumé).
 */
export function shipStartPose(): StartPose {
  return started ? startPose("") : START;
}
/** Spaceship has placed its first ship. */
export function markShipStarted(): void { started = true; }

export interface FlightInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  boost: boolean;
  ascend: boolean;
  descend: boolean;
  /** Analog steering from touch joystick, -1 (left) .. 1 (right). 0 = keyboard only. */
  steer: number;
  /** Analog thrust from touch joystick, -1 (brake) .. 1 (full). 0 = keyboard only. */
  thrust: number;
  scan: boolean;
  /** Tractor beam held (F, gamepad LB, touch BEAM). */
  beam: boolean;
}

/**
 * Per-frame telemetry. Mutated inside useFrame/rAF loops and read the same
 * way — deliberately NOT in React state so flight never re-renders the tree.
 */
export const flight = {
  x: START.x,
  z: START.z,
  y: START.y, // altitude, written by Spaceship each frame
  speed: 0, // world units / second
  heading: START.heading ?? 0, // yaw in radians, written by Spaceship each frame
  pitch: START.pitch, // nose pitch in radians (+up), written by Spaceship each frame
  /**
   * The pilot has flown at least once this page (Spaceship sets it). Live sky
   * connects only after it. A race link counts as flown: the visitor came to race.
   */
  hasFlown: START.race,
  input: {
    forward: false, backward: false, left: false, right: false,
    boost: false, ascend: false, descend: false, steer: 0, thrust: 0, scan: false, beam: false,
  } as FlightInput,
  /**
   * Warp fuel, 0..FUEL_MAX. Written by Spaceship's frame loop (continuous
   * drain while warping, refill while not) and by AsteroidBelt's mining
   * (ore tops it up), and read by the HUD/radar rAF loops. Deliberately here
   * rather than in the store: it changes every frame while warping, and store
   * state would make that a per-frame React commit, breaking the
   * zero-renders-during-flight guarantee.
   * Starts full — fuel is session state, not persisted progress.
   */
  fuel: FUEL_MAX,
  /** The return burn is running this frame (Spaceship writes it; EdgeHaze reads it for the radio line). */
  edgeBurn: false,
  /**
   * On a race's grid or racing it (RaceCourse writes it from the race view):
   * warp is held to the base speed, jumps and beam dossiers are off.
   */
  racing: false,
  /** Held on the race grid until GO (RaceCourse writes it): Spaceship keeps the ship still. */
  raceHold: false,
};
