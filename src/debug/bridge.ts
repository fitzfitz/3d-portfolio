import type * as THREE from "three";
import { useSpaceStore, flight, bodies } from "../store/spaceStore";
import { soundManager } from "../audio/soundManager";
import { perfStats } from "./perfStats";

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
  /**
   * Live plasma anomaly pool, registered by PlasmaAnomalies in dev. Null
   * until mounted. Only `active` is asserted on by e2e today, so the shape
   * here is intentionally minimal rather than mirroring the full `Anomaly`
   * interface (position/velocity/colorIdx/phase), which stays private to
   * PlasmaAnomalies.tsx.
   */
  anomalies: { active: boolean }[] | null;
  /**
   * Live renderer counters sampled in-frame by PerfSampler, before
   * EffectComposer resets `gl.info` — see PerfSampler's own comment. Exposed
   * here so e2e probes can read `calls`/`triangles` reliably; `lights` on
   * this object is throttled to one traversal every 30 frames and must NOT
   * be used in e2e (see docs/PERF-BUDGETS.md) — traverse `scene` directly
   * for a frame-independent light count instead.
   */
  perfStats: typeof perfStats;
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
  anomalies: null,
  perfStats,
};
