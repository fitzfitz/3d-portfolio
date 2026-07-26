import type * as THREE from "three";
import { useSpaceStore, flight, bodies } from "../store/spaceStore";
import { soundManager } from "../audio/soundManager";
import { animScale, setAnimScale } from "../utils/animScale";

/**
 * Dev-only surface for e2e probes. Holds live references (never copies) so a
 * probe reading `__fitz.flight.x` sees the same object the frame loop mutates.
 * The window handle is assigned in main.tsx under an import.meta.env.DEV guard
 * so the string `__fitz` is dead-code-eliminated from production builds.
 */
export interface FitzDebug {
  store: typeof useSpaceStore;
  flight: typeof flight;
  bodies: typeof bodies;
  sound: typeof soundManager;
  scene: THREE.Scene | null;
  gl: THREE.WebGLRenderer | null;
  camera: THREE.Camera | null;
  /** React commits, incremented by the dev-only Profiler in main.tsx. */
  renderCount: number;
  /**
   * Moves the ship immediately. Registered by Spaceship in dev, because
   * `flight.{x,y,z}` is write-only telemetry — see Spaceship's own comment.
   * Null until Spaceship mounts.
   */
  teleport: ((x: number, y: number, z: number) => void) | null;
  /**
   * Live decorative-animation multiplier, for tuning amplitudes by eye instead
   * of by rebuild. `__fitz.setAnimScale(4)` in the console, watch, repeat.
   * Temporary: once the right factors are known they are baked into the
   * constants at each site and this goes away.
   */
  setAnimScale: (v: number) => number;
  animScale: () => number;
}

export const fitzDebug: FitzDebug = {
  store: useSpaceStore,
  flight,
  bodies,
  sound: soundManager,
  scene: null,
  gl: null,
  camera: null,
  renderCount: 0,
  teleport: null,
  setAnimScale,
  animScale,
};
