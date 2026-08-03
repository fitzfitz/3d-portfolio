import type * as THREE from "three";
import { useSpaceStore, flight, bodies } from "../store/spaceStore";
import { soundManager } from "../audio/soundManager";

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
   * Renders of the GlobalCanvas component, incremented in its render body.
   * Distinct from `renderCount`: main.tsx's Profiler wraps the DOM tree only
   * and structurally cannot observe R3F's separate reconciler root, so the
   * canvas subtree needs its own counter. StrictMode double-renders inflate
   * the absolute value; only deltas across an action are meaningful.
   */
  canvasRenderCount: number;
  /**
   * Moves the ship immediately. Registered by Spaceship in dev, because
   * `flight.{x,y,z}` is write-only telemetry — see Spaceship's own comment.
   * Null until Spaceship mounts.
   */
  teleport: ((x: number, y: number, z: number) => void) | null;
  /** Live crystal slots, registered by FuelCrystals in dev. Null until mounted. */
  crystals: { x: number; y: number; z: number; active: boolean }[] | null;
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
  canvasRenderCount: 0,
  teleport: null,
  crystals: null,
};
