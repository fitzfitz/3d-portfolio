import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

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
  input: {
    forward: false, backward: false, left: false, right: false,
    boost: false, ascend: false, descend: false, steer: 0, thrust: 0, scan: false,
  } as FlightInput,
};

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
}

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
    // Guarded setters: these are called from frame loops, so bail without
    // notifying when the value hasn't changed.
    setActiveZone: (z) => { if (get().activeZone !== z) set({ activeZone: z }); },
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
  }))
);
