import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { planets } from "../constants";
import { orbitPosition } from "../utils/orbits";
import { REDUCED_MOTION_KEY, REDUCED_MOTION_QUERY, resolveReducedMotion } from "../utils/reducedMotionPreference";
import { setAmbientEnabled } from "../utils/ambientTime";
import { FUEL_MAX } from "../utils/fuel";

// Module-level timeout handles for cancellation on re-entry
let orbitCooldownTimer: ReturnType<typeof setTimeout> | null = null;
let teleportFlashTimer: ReturnType<typeof setTimeout> | null = null;

// localStorage can throw (e.g. SecurityError when cookies/storage are blocked) —
// guard both accesses so a blocked store degrades to in-memory rather than crashing.
function safeGetMuted(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("fitz-sound-muted") === "1";
  } catch {
    return false;
  }
}
function safeSetMuted(v: boolean) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem("fitz-sound-muted", v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// Three states — "1", "0", or absent — because absent (no choice made) must
// stay distinguishable from an explicit false, which has to beat a media
// query that says true.
function safeGetReducedMotion(): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(REDUCED_MOTION_KEY);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}
function safeSetReducedMotion(v: boolean) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(REDUCED_MOTION_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// `matchMedia` can be absent (old browser, SSR-ish context) — degrade to "no
// preference" rather than throwing. Seeding from the live query at module
// scope (rather than assuming `false`) closes a startup gap for an OS-reduce
// visitor with nothing stored: without it, `reducedMotion` and the ambient
// clock would both start as if no preference were set, and only flip once
// the sync effect in useReducedMotion ran after first paint.
function safeGetReducedMotionQueryMatches(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

function safeGetJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function safeSetJSON(key: string, value: unknown) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

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
}

/**
 * Per-frame telemetry. Mutated inside useFrame/rAF loops and read the same
 * way — deliberately NOT in React state so flight never re-renders the tree.
 */
export const flight = {
  x: 0,
  z: 18,
  y: 0, // altitude, written by Spaceship each frame
  speed: 0, // world units / second
  heading: 0, // yaw in radians, written by Spaceship each frame
  pitch: 0, // nose pitch in radians (+up), written by Spaceship each frame
  input: {
    forward: false, backward: false, left: false, right: false,
    boost: false, ascend: false, descend: false, steer: 0, thrust: 0, scan: false,
  } as FlightInput,
  /**
   * Warp fuel, 0..FUEL_MAX. Written by Spaceship's frame loop (continuous
   * drain while warping) and by FuelCrystals' pickup (discrete refuel on
   * collection), and read by the HUD/radar rAF loops. Deliberately here
   * rather than in the store: it changes every frame while warping, and store
   * state would make that a per-frame React commit, breaking the
   * zero-renders-during-flight guarantee.
   * Starts full — fuel is session state, not persisted progress.
   */
  fuel: FUEL_MAX,
};

/**
 * Live positions of orbiting bodies, written once per frame by SpacePlanets'
 * useFrame and read by Spaceship (lock center), RadarMap, HUD, and the
 * scannable registry. Mutable outside React — same pattern as `flight`.
 */
export const bodies: Record<string, { x: number; y: number; z: number }> = Object.fromEntries(
  planets.map((p) => [p.name, orbitPosition(p.orbit, 0)])
);

export interface CrystalSlot { x: number; y: number; z: number; active: boolean }

/**
 * Live fuel-crystal slots, seeded and mutated by FuelCrystals' frame loop and
 * read by RadarMap's rAF loop. Module-level and mutable outside React — the same
 * pattern as `flight` and `bodies` above, and for the same reason: a pickup or a
 * respawn must not cost a React render.
 *
 * Deliberately NOT routed through the debug bridge: that is dead-code-eliminated
 * in production, so the radar would draw no crystal blips for real visitors, and
 * at ~146-unit mean spacing the mechanic needs that cue to be findable at all.
 */
export const crystalSlots: CrystalSlot[] = [];

interface SpaceState {
  activeZone: string | null;
  isOrbitLocked: boolean;
  isOrbitCooldown: boolean;
  isWarping: boolean;
  isLowPerf: boolean;
  lowPerfManual: boolean;
  showClassicCV: boolean;
  isNearSpawn: boolean;
  isTeleporting: boolean;
  isMuted: boolean;
  cometNear: boolean;
  altitudeWarn: boolean;
  shardsCollected: number[];
  broadcast: { id: number; text: string } | null;
  impactCount: number;
  scanTarget: string | null;
  photoMode: boolean;
  reducedMotion: boolean;
  reducedMotionManual: boolean;
  fuelEmpty: boolean;
  setFuelEmpty: (v: boolean) => void;
  setActiveZone: (z: string | null) => void;
  setOrbitLocked: (v: boolean) => void;
  breakOrbit: () => void;
  setWarping: (v: boolean) => void;
  setLowPerf: (v: boolean, manual?: boolean) => void;
  setShowClassicCV: (v: boolean) => void;
  setNearSpawn: (v: boolean) => void;
  triggerTeleportFlash: () => void;
  setMuted: (v: boolean) => void;
  setCometNear: (v: boolean) => void;
  setAltitudeWarn: (v: boolean) => void;
  collectShard: (i: number) => void;
  sendBroadcast: (text: string) => void;
  bumpImpact: () => void;
  setScanTarget: (v: string | null) => void;
  setPhotoMode: (v: boolean) => void;
  setReducedMotion: (v: boolean, manual?: boolean) => void;
}

// Read once into a module-level const: the two derived fields below must
// agree, and calling the helper twice could in principle race with a
// concurrent write.
const storedReducedMotion = safeGetReducedMotion();
const initialReducedMotionQueryMatches = safeGetReducedMotionQueryMatches();
// Synchronise the ambient clock here, at module scope, not inside a mount
// effect: the effect that would otherwise do this (Task 3's media-query sync)
// skips its own call when the choice is manual, since manual already reflects
// the visitor's intent. Without this line a reload with reduced motion stored
// ON would leave `enabled` at its `true` default until the visitor toggled
// the HUD button twice — the store would say reduced motion is on while the
// decorative clock kept advancing.
setAmbientEnabled(!resolveReducedMotion(storedReducedMotion, initialReducedMotionQueryMatches));

export const useSpaceStore = create<SpaceState>()(
  subscribeWithSelector((set, get) => ({
    activeZone: null,
    isOrbitLocked: false,
    isOrbitCooldown: false,
    isWarping: false,
    isLowPerf: false,
    lowPerfManual: false,
    showClassicCV: false,
    isNearSpawn: true,
    isTeleporting: false,
    isMuted: safeGetMuted(),
    cometNear: false,
    altitudeWarn: false,
    shardsCollected: safeGetJSON<number[]>("fitz-shards", []),
    broadcast: null,
    impactCount: 0,
    scanTarget: null,
    photoMode: false,
    reducedMotion: resolveReducedMotion(storedReducedMotion, initialReducedMotionQueryMatches),
    reducedMotionManual: storedReducedMotion !== null,
    fuelEmpty: false,
    // Guarded setters: these are called from frame loops, so bail without
    // notifying when the value hasn't changed.
    setActiveZone: (z) => { if (get().activeZone !== z) set({ activeZone: z }); },
    // Change-guarded: called from a frame loop, so it must not notify unless the
    // value actually flipped.
    setFuelEmpty: (v) => { if (get().fuelEmpty !== v) set({ fuelEmpty: v }); },
    setOrbitLocked: (v) => { if (get().isOrbitLocked !== v) set({ isOrbitLocked: v }); },
    setWarping: (v) => { if (get().isWarping !== v) set({ isWarping: v }); },
    setNearSpawn: (v) => { if (get().isNearSpawn !== v) set({ isNearSpawn: v }); },
    setCometNear: (v) => { if (get().cometNear !== v) set({ cometNear: v }); },
    setLowPerf: (v, manual = false) =>
      set((s) => ({ isLowPerf: v, lowPerfManual: s.lowPerfManual || manual })),
    setShowClassicCV: (v) => set({ showClassicCV: v }),
    setMuted: (v) => {
      set({ isMuted: v });
      safeSetMuted(v);
    },
    breakOrbit: () => {
      if (orbitCooldownTimer) clearTimeout(orbitCooldownTimer);
      set({ isOrbitLocked: false, activeZone: null, isOrbitCooldown: true });
      orbitCooldownTimer = setTimeout(() => set({ isOrbitCooldown: false }), 1800);
    },
    triggerTeleportFlash: () => {
      if (teleportFlashTimer) clearTimeout(teleportFlashTimer);
      set({ isTeleporting: true });
      teleportFlashTimer = setTimeout(() => set({ isTeleporting: false }), 380);
    },
    setAltitudeWarn: (v) => { if (get().altitudeWarn !== v) set({ altitudeWarn: v }); },
    collectShard: (i) => {
      const cur = get().shardsCollected;
      if (cur.includes(i)) return;
      const next = [...cur, i];
      set({ shardsCollected: next });
      safeSetJSON("fitz-shards", next);
    },
    sendBroadcast: (text) => set({ broadcast: { id: (get().broadcast?.id ?? 0) + 1, text } }),
    bumpImpact: () => set({ impactCount: get().impactCount + 1 }),
    setScanTarget: (v) => { if (get().scanTarget !== v) set({ scanTarget: v }); },
    setPhotoMode: (v) => set({ photoMode: v }),
    setReducedMotion: (v, manual = false) => {
      if (manual) safeSetReducedMotion(v);
      // Ambient motion is the inverse of reduced motion.
      setAmbientEnabled(!v);
      set((s) => ({ reducedMotion: v, reducedMotionManual: s.reducedMotionManual || manual }));
    },
  }))
);
