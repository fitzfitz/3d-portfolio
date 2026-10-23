import type * as THREE from "three";
import { useSpaceStore, flight, bodies } from "../store/spaceStore";
import { moonPositions } from "../store/moonState";
import { soundManager } from "../audio/soundManager";
import { perfStats } from "./perfStats";
import { raceClock } from "../utils/raceClock";
import type { JellyState } from "../utils/jellyMood";
import type { GuideName, GuideState } from "../utils/jellyGuide";
import type { WorldEventKind } from "../utils/eventDirector";
import type { LiveSkyConnection } from "../utils/liveSkyConnection";
import { liveRadar } from "../utils/liveSky";
import { orreryEpochJd, setOrreryEpochJd } from "../utils/orreryClock";

/**
 * Dev-only surface for e2e probes. Holds live references (never copies) so a
 * probe reading `__fitz.flight.x` sees the same object the frame loop mutates.
 * The window handle is assigned in main.tsx under an import.meta.env.DEV guard
 * so the string `__fitz` is dead-code-eliminated from production builds.
 */
/**
 * The jellyfish guide as SpaceJellyfish writes it each frame (spec
 * 2026-10-23-jellyfish-guide; ruling R6), for the guide's e2e probe.
 */
export interface JellyGuideDebug {
  state: GuideName;
  /** The creature's world position. */
  pos: { x: number; y: number; z: number };
  /** The posture's smoothed velocity (u/s), live (jellyPosture.ts PostureState.vel): read its direction; it is capped at POSTURE_V_MAX. */
  vel: { x: number; y: number; z: number };
  /** The body's +y (the bell axis) in world space, unit length. */
  up: { x: number; y: number; z: number };
  /** The 0..1 swim factor (uSwim before reduced motion zeroes it). */
  swim: number;
  /** The glow streak's length, 0..1 (uStreak). */
  streak: number;
  /** Swimming home after a hand-back. */
  returning: boolean;
  /** The guide state machine itself, live (event, timers, waiting). */
  guide: GuideState;
}

export interface FitzDebug {
  store: typeof useSpaceStore;
  flight: typeof flight;
  bodies: typeof bodies;
  /** The nine moons' live centres by moon id (store/moonState.ts), written by SolarMoons each frame. */
  moons: typeof moonPositions;
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
  /** Live probe positions (probeState.ts), registered by ProjectProbes in dev. Null until mounted. */
  probes: typeof import("../store/probeState").probePos | null;
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
  /** Live jellyfish guide (controller ruling R6), registered by SpaceJellyfish in dev. */
  jellyGuide: JellyGuideDebug | null;
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
   * The world-event director's live state (clock, nextAt, active), registered
   * by WorldEventDirector in dev: events.probe.mjs sets the clock near its
   * first due start instead of waiting out FIRST_EVENT_AT in real time.
   */
  eventDirector: import("../utils/eventDirector").DirectorState | null;
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
   * SolarBodies in dev: `uOccluders.value[i]` is slot i (xyz world position,
   * w radius; sunShadow.ts bodySlot / moonSlot: the bodies with a moon or a
   * ring 0-5, the nine moons 6-14), `uOccluderCount` how many are read (15).
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
   * Registered by SolarBodies in dev.
   */
  sunShadowDebug: typeof import("../components/canvas/sunShadow").sunShadowDebug | null;
  /** Set `holdRegen` to pause the fuel auto-refill (e2e fuel probe). Registered by Spaceship in dev. */
  fuelDebug: typeof import("../utils/fuel").fuelDebug | null;
  /** Orrery epoch (JD at game time 0): read, or set to jump the date. */
  orrery: { epochJd: () => number; setEpochJd: (jd: number) => void };
}

export const fitzDebug: FitzDebug = {
  store: useSpaceStore,
  flight,
  bodies,
  moons: moonPositions,
  raceClock,
  sound: soundManager,
  scene: null,
  gl: null,
  camera: null,
  renderCount: 0,
  canvasRenderCount: 0,
  teleport: null,
  setAttitude: null,
  probes: null,
  crystals: null,
  anomalies: null,
  cargoSwerve: null,
  jelly: null,
  jellyGuide: null,
  triggerEvent: null,
  eventDirector: null,
  gravity: null,
  beam: null,
  mining: null,
  liveSky: null,
  liveRadar,
  perfStats,
  sunShadow: null,
  shipShadow: null,
  sunShadowDebug: null,
  fuelDebug: null,
  orrery: { epochJd: orreryEpochJd, setEpochJd: setOrreryEpochJd },
};
