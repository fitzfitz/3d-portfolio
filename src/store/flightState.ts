import { SPAWN } from "../data/spawn";
import { FUEL_MAX } from "../utils/fuel";

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
  x: SPAWN.x as number, // widened: SPAWN is `as const`, flight is mutated
  z: SPAWN.z as number,
  y: SPAWN.y as number, // altitude, written by Spaceship each frame
  speed: 0, // world units / second
  heading: 0, // yaw in radians, written by Spaceship each frame
  pitch: 0, // nose pitch in radians (+up), written by Spaceship each frame
  /** The pilot has flown at least once this page (Spaceship sets it). Live sky connects only after it. */
  hasFlown: false,
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
};
