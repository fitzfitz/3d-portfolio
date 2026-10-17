import type * as THREE from "three";
import { useSpaceStore, flight, bodies } from "../store/spaceStore";
import { soundManager } from "../audio/soundManager";
import { perfStats } from "./perfStats";
import { raceClock } from "../utils/raceClock";
import type { JellyState } from "../utils/jellyMood";
import type { WorldEventKind } from "../utils/eventDirector";
import type { LiveSkyConnection } from "../utils/liveSkyConnection";
import { liveRadar } from "../utils/liveSky";

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
  /** Time-trial clock (seconds), live. */
  raceClock: typeof raceClock;
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
  /**
   * Sets the ship's yaw/pitch (radians) and ends the spawn auto-aim, so a
   * probe can fly a known heading. The ship now spawns aimed at a planet, so
   * "heading 0 at mount" is no longer something a probe can rely on.
   * Registered by Spaceship in dev. Null until Spaceship mounts.
   */
  setAttitude: ((yaw: number, pitch: number) => void) | null;
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
  /** Live cargo swerve offsets, one per ship, registered by CargoTraffic in dev. */
  cargoSwerve: { x: number; y: number; z: number }[] | null;
  /** Live jellyfish mood and offset, registered by SpaceJellyfish in dev. */
  jelly: JellyState | null;
  /** Live mining state (AsteroidBelt, dev only). */
  mining: typeof import("../utils/mining").miningState | null;
  /** The live sky connection (Ghosts, dev only): peers, ghosts, sent count. */
  liveSky: LiveSkyConnection | null;
  /** Live pilots on the HUD radar (liveSky.ts), dev only. */
  liveRadar: typeof import("../utils/liveSky").liveRadar;
  /** Live tractor-beam state (Spaceship, dev only). */
  beam: typeof import("../store/beamState").beamState | null;
  /** Live gravity momentum G (Spaceship, dev only). */
  gravity: { x: number; y: number; z: number } | null;
  /** Starts a world event now (dev only), registered by WorldEventDirector. */
  triggerEvent: ((kind: WorldEventKind) => void) | null;
  /**
   * Live renderer counters sampled in-frame by PerfSampler, before
   * EffectComposer resets `gl.info` — see PerfSampler's own comment. Exposed
   * here so e2e probes can read `calls`/`triangles` reliably; `lights` on
   * this object is throttled to one traversal every 30 frames and must NOT
   * be used in e2e (see docs/PERF-BUDGETS.md) — traverse `scene` directly
   * for a frame-independent light count instead.
   */
  perfStats: typeof perfStats;
  /**
   * The shared eclipse uniforms (sunShadow.ts), live, registered by
   * SpacePlanets in dev: `uOccluders.value[i]` is slot i (xyz world position,
   * w radius; planets first, then moons in MOONS order), `uOccluderCount` how
   * many are read.
   */
  sunShadow: typeof import("../components/canvas/sunShadow").sunShadowUniforms | null;
  /**
   * The player ship's eclipse state (Spaceship, dev only): `sunVis.value` is
   * the visible fraction of the sun (1 clear, 0 eclipsed), shared by every
   * patched hull material in `materials`.
   */
  shipShadow: { sunVis: { value: number }; materials: THREE.Material[] } | null;
  /**
   * Set `countOverride` to 0 to switch the per-fragment eclipse loop off
   * (frame-cost measurement, docs/PERF-BUDGETS.md); -1 restores it.
   * Registered by SpacePlanets in dev.
   */
  sunShadowDebug: typeof import("../components/canvas/sunShadow").sunShadowDebug | null;
}

export const fitzDebug: FitzDebug = {
  store: useSpaceStore,
  flight,
  bodies,
  raceClock,
  sound: soundManager,
  scene: null,
  gl: null,
  camera: null,
  renderCount: 0,
  canvasRenderCount: 0,
  teleport: null,
  setAttitude: null,
  crystals: null,
  anomalies: null,
  cargoSwerve: null,
  jelly: null,
  triggerEvent: null,
  gravity: null,
  beam: null,
  mining: null,
  liveSky: null,
  liveRadar,
  perfStats,
  sunShadow: null,
  shipShadow: null,
  sunShadowDebug: null,
};
