import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { parseRaceBest, type RaceState } from "../utils/race";
import type { WorldEventKind } from "../utils/eventDirector";
import type { CometPass, ConvoyPlan } from "../utils/worldEvents";
import type { Beacon } from "../utils/beacons";
import { planets } from "../constants";
import { orbitPosition } from "../utils/orbits";
import { REDUCED_MOTION_KEY, REDUCED_MOTION_QUERY, resolveReducedMotion } from "../utils/reducedMotionPreference";
import { setAmbientEnabled } from "../utils/ambientTime";
import { FUEL_MAX } from "../utils/fuel";
import { isRecordable, badgeLine, plumeAllowed, LOGBOOK, type BadgeRecord } from "../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../data/plumeColors";
import { CHANGELOG } from "../data/changelog";
import { SHARDS } from "../data/shards";

const PLANET_IDS: readonly string[] = planets.map((p) => p.name);

// Module-level timeout handles for cancellation on re-entry
let orbitCooldownTimer: ReturnType<typeof setTimeout> | null = null;
let teleportFlashTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * A badge earned in the same moment as its payoff (a scan report, a lap time)
 * must not cut that line off: RadioChatter's single typewriter line cancels
 * whatever it is typing. Same delay as the shard-completion fanfare.
 */
const BADGE_LINE_HOLD_MS = 3000;
const BADGE_LINE_DELAY_MS = 4500;

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

/**
 * Whether this browser can create a WebGL context at all. Without one the 3D
 * scene cannot run, so the visitor starts on the classic résumé instead of a
 * blank page. Never throws: a blocked or broken canvas counts as "no".
 */
export function hasWebGL(doc: Document | undefined = typeof document !== "undefined" ? document : undefined): boolean {
  try {
    if (!doc) return false;
    const c = doc.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * True when the URL asks for the résumé directly (`?cv`, `?resume`, `#cv`,
 * `#resume`) — a link a visitor can be sent that skips the flight entirely.
 */
export function wantsResume(loc: { search: string; hash: string } | undefined =
  typeof window !== "undefined" ? window.location : undefined): boolean {
  if (!loc) return false;
  const q = new URLSearchParams(loc.search);
  return q.has("cv") || q.has("resume") || /^#(cv|resume)$/i.test(loc.hash);
}

/**
 * Read dossiers from storage, keeping only current planet ids: ids from an
 * older content set (e.g. "saas") must not count toward n/3, and a value that
 * isn't an array (hand-edited storage) must not crash the store at import.
 */
function loadVisitedDossiers(): string[] {
  const raw = safeGetJSON<unknown>("fitz-dossiers", []);
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && PLANET_IDS.includes(id)) : [];
}

/** Local date as YYYY-MM-DD, for the "earned" stamp. */
export function todayStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Stored badges, sanitised: known recordable ids only, a string date, first
 * occurrence wins. Hand-edited or stale storage must not crash the store or
 * grant anything.
 */
export function loadBadges(raw: unknown): BadgeRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: BadgeRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id, at } = r as { id?: unknown; at?: unknown };
    if (typeof id !== "string" || typeof at !== "string" || !isRecordable(id)) continue;
    if (out.some((b) => b.id === id)) continue;
    out.push({ id, at });
  }
  return out;
}

/**
 * Stored shard pickups, sanitised: unique integer indices of real shards. A
 * hand-edited or corrupt value (null, a string) must not crash the store at
 * import or grant the Shard hunter badge.
 */
export function loadShards(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    if (Number.isInteger(v) && v >= 0 && v < SHARDS.length && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Probed once at import: each probe creates a throwaway WebGL context. */
export const WEBGL_AVAILABLE = hasWebGL();

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
  /** Tractor beam held (F, gamepad LB, touch BEAM). */
  beam: boolean;
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
    boost: false, ascend: false, descend: false, steer: 0, thrust: 0, scan: false, beam: false,
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

/** The running world event (docs/superpowers/specs/2026-10-12-world-events-design.md). */
export interface WorldEventState {
  kind: WorldEventKind;
  id: number;
  /** Director clock (flying seconds) at start; compare with worldClock.now. */
  startedAt: number;
  comet?: CometPass;
  convoy?: { planet: string; plan: ConvoyPlan };
}

interface SpaceState {
  activeZone: string | null;
  isOrbitLocked: boolean;
  isOrbitCooldown: boolean;
  isWarping: boolean;
  isLowPerf: boolean;
  lowPerfManual: boolean;
  /**
   * A tier switch requested during shader warm-up, applied when warm-up ends.
   * Switching mid-warm-up unmounts the full-detail objects and disposes
   * materials three's compileAsync is still polling; its poll then throws
   * ("reading 'isReady'") and ShaderWarmup waits out its 8s cap.
   */
  pendingLowPerf: boolean | null;
  worldEvent: WorldEventState | null;
  showClassicCV: boolean;
  isNearSpawn: boolean;
  isTeleporting: boolean;
  isMuted: boolean;
  cometNear: boolean;
  altitudeWarn: boolean;
  shardsCollected: number[];
  /** The latest radio line; `at` (Date.now) lets a badge line wait for a fresh one to be read. */
  broadcast: { id: number; text: string; silent: boolean; at: number } | null;
  impactCount: number;
  scanTarget: string | null;
  photoMode: boolean;
  /** A gamepad has reported in (it does only after its first button press). */
  padConnected: boolean;
  /** Time-trial progress (RingCourse.tsx). Changes only at gates, never per frame. */
  race: RaceState;
  /** Best lap in seconds, persisted; null until the first finish. */
  raceBest: number | null;
  /** Visitor beacons from the beacon API (empty when it is not configured). */
  beacons: Beacon[];
  /** Ids of beacons this browser dropped, persisted, so they render as "yours". */
  ownBeacons: string[];
  beaconPickerOpen: boolean;
  reducedMotion: boolean;
  reducedMotionManual: boolean;
  fuelEmpty: boolean;
  /** True once every Suspense-loaded asset has resolved and the scene is on screen. */
  sceneReady: boolean;
  /** True while ShaderWarmup holds the frame loop for async shader compile. */
  warmingUp: boolean;
  setWarmingUp: (v: boolean) => void;
  /** Project ids whose dossier has been opened (persisted). Drives DOSSIERS n/3. */
  visitedDossiers: string[];
  /**
   * Pending jump to a planet id or "contact", consumed by Spaceship's frame
   * loop. `seq` makes a repeat request for the same target a new value.
   */
  jumpRequest: { id: string; seq: number } | null;
  requestJump: (id: string) => void;
  setSceneReady: (v: boolean) => void;
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
  /**
   * Shows a line on the radio. `silent` lines (cargo hails, flavour such as
   * the haze and slingshot callouts) are not announced to screen readers:
   * the aria-live region is for content a visitor acted to get.
   */
  sendBroadcast: (text: string, opts?: { silent?: boolean }) => void;
  bumpImpact: () => void;
  setScanTarget: (v: string | null) => void;
  setPhotoMode: (v: boolean) => void;
  setPadConnected: (v: boolean) => void;
  setRace: (r: RaceState) => void;
  setRaceBest: (t: number) => void;
  setBeacons: (b: Beacon[]) => void;
  addOwnBeacon: (id: string) => void;
  setBeaconPickerOpen: (v: boolean) => void;
  setReducedMotion: (v: boolean, manual?: boolean) => void;
  startWorldEvent: (ev: WorldEventState, line: string) => void;
  endWorldEvent: () => void;
  /** Logbook badges earned (persisted as fitz-logbook). Dossiers and shards are derived elsewhere. */
  badges: BadgeRecord[];
  recordBadge: (id: string) => void;
  /** Selected plume colour: "stock" or an unlocked badge id (persisted as fitz-plume). */
  plumeColor: string;
  setPlumeColor: (id: string) => void;
  logbookOpen: boolean;
  setLogbookOpen: (v: boolean) => void;
  /** When the radio is next free for a logbook line (ms); logbook lines queue rather than cut each other off. */
  logbookLineAt: number;
  /**
   * Announces a logbook line (badge earned, milestone). Decided after the
   * current frame's broadcasts are out, so a payoff sent in the same frame,
   * before or after, is read first: a fresh broadcast holds the line 4.5 s,
   * and logbook lines queue 4.5 s apart.
   */
  announceLogbook: (line: string) => void;
  changelogOpen: boolean;
  setChangelogOpen: (v: boolean) => void;
  /** Newest changelog id the visitor has seen (persisted as fitz-changelog-seen). */
  changelogSeen: string;
  markChangelogSeen: () => void;
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

const initialBadges = loadBadges(safeGetJSON<unknown>("fitz-logbook", []));
const initialPlume = (() => {
  const raw = safeGetJSON<unknown>("fitz-plume", "stock");
  const progress = { visitedDossiers: loadVisitedDossiers(), shardsCollected: loadShards(safeGetJSON<unknown>("fitz-shards", [])), badges: initialBadges };
  return typeof raw === "string" && plumeAllowed(raw, progress, hasPlumeColour) ? raw : "stock";
})();

/** First visit: everything is new, so mark the newest entry seen and show no dot. */
const initialChangelogSeen = (() => {
  const raw = safeGetJSON<unknown>("fitz-changelog-seen", null);
  if (typeof raw === "string") return raw;
  safeSetJSON("fitz-changelog-seen", CHANGELOG[0].id);
  return CHANGELOG[0].id;
})();

export const useSpaceStore = create<SpaceState>()(
  subscribeWithSelector((set, get) => ({
    activeZone: null,
    isOrbitLocked: false,
    isOrbitCooldown: false,
    isWarping: false,
    isLowPerf: false,
    lowPerfManual: false,
    pendingLowPerf: null,
    worldEvent: null,
    badges: initialBadges,
    plumeColor: initialPlume,
    logbookOpen: false,
    logbookLineAt: 0,
    announceLogbook: (line) => {
      queueMicrotask(() => {
        const now = Date.now();
        const fresh = now - (get().broadcast?.at ?? -Infinity) < BADGE_LINE_HOLD_MS;
        const at = Math.max(fresh ? now + BADGE_LINE_DELAY_MS : now, get().logbookLineAt);
        set({ logbookLineAt: at + BADGE_LINE_DELAY_MS });
        // When its slot arrives, a queued line still yields to anything that
        // went out meanwhile (a race abort, a scan report), up to a few times.
        const fire = (tries: number, queuedAt: number) => {
          const last = get().broadcast;
          const busy = last && last.at > queuedAt && Date.now() - last.at < BADGE_LINE_HOLD_MS;
          if (busy && tries > 0) { setTimeout(() => fire(tries - 1, Date.now()), BADGE_LINE_DELAY_MS); return; }
          get().sendBroadcast(line);
        };
        if (at <= now) get().sendBroadcast(line);
        else setTimeout(() => fire(3, now), at - now);
      });
    },
    recordBadge: (id) => {
      if (!isRecordable(id) || get().badges.some((b) => b.id === id)) return;
      const next = [...get().badges, { id, at: todayStamp() }];
      safeSetJSON("fitz-logbook", next);
      set({ badges: next });
      const entry = LOGBOOK.find((e) => e.id === id);
      get().announceLogbook(badgeLine(id, entry?.plume ? PLUME_COLORS[id]?.name ?? null : null));
    },
    setPlumeColor: (id) => {
      const s = get();
      const progress = { visitedDossiers: s.visitedDossiers, shardsCollected: s.shardsCollected, badges: s.badges };
      if (!plumeAllowed(id, progress, hasPlumeColour) || s.plumeColor === id) return;
      safeSetJSON("fitz-plume", id);
      set({ plumeColor: id });
    },
    setLogbookOpen: (v) => {
      if (get().logbookOpen === v) return;
      set(v ? { logbookOpen: true, changelogOpen: false } : { logbookOpen: false });
    },
    changelogOpen: false,
    changelogSeen: initialChangelogSeen,
    setChangelogOpen: (v) => {
      if (get().changelogOpen === v) return;
      set(v ? { changelogOpen: true, logbookOpen: false } : { changelogOpen: false });
    },
    markChangelogSeen: () => {
      const newest = CHANGELOG[0].id;
      if (get().changelogSeen === newest) return;
      safeSetJSON("fitz-changelog-seen", newest);
      set({ changelogSeen: newest });
    },
    // No WebGL means no scene: start on the résumé rather than a blank page.
    showClassicCV: !WEBGL_AVAILABLE || wantsResume(),
    isNearSpawn: true,
    isTeleporting: false,
    isMuted: safeGetMuted(),
    cometNear: false,
    altitudeWarn: false,
    shardsCollected: loadShards(safeGetJSON<unknown>("fitz-shards", [])),
    broadcast: null,
    impactCount: 0,
    scanTarget: null,
    photoMode: false,
    padConnected: false,
    race: { phase: "idle" },
    raceBest: parseRaceBest(safeGetJSON<unknown>("fitz-race-best", null)),
    beacons: [],
    ownBeacons: (() => {
      const raw = safeGetJSON<unknown>("fitz-own-beacons", []);
      return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
    })(),
    beaconPickerOpen: false,
    reducedMotion: resolveReducedMotion(storedReducedMotion, initialReducedMotionQueryMatches),
    reducedMotionManual: storedReducedMotion !== null,
    fuelEmpty: false,
    sceneReady: false,
    warmingUp: false,
    setWarmingUp: (v) => {
      const s = get();
      if (s.warmingUp === v) return;
      // Ending warm-up releases a tier switch held back during it (setLowPerf).
      if (!v && s.pendingLowPerf !== null) set({ warmingUp: false, isLowPerf: s.pendingLowPerf, pendingLowPerf: null });
      else set({ warmingUp: v });
    },
    visitedDossiers: loadVisitedDossiers(),
    jumpRequest: null,
    requestJump: (id) => {
      if (id !== "contact" && !PLANET_IDS.includes(id)) return;
      set({ jumpRequest: { id, seq: (get().jumpRequest?.seq ?? 0) + 1 } });
    },
    setSceneReady: (v) => { if (get().sceneReady !== v) set({ sceneReady: v }); },
    // Guarded setters: these are called from frame loops, so bail without
    // notifying when the value hasn't changed.
    setActiveZone: (z) => { if (get().activeZone !== z) set({ activeZone: z }); },
    // Change-guarded: called from a frame loop, so it must not notify unless the
    // value actually flipped.
    setFuelEmpty: (v) => { if (get().fuelEmpty !== v) set({ fuelEmpty: v }); },
    // Locking freezes the frame loop (selectSceneFrozen), so the ship can no
    // longer clear isWarping itself — clear it here or the warp drone and the
    // HUD's "ACTIVE" line outlive the boost for as long as the dossier is open.
    // Locking onto a project planet also records the dossier as read.
    setOrbitLocked: (v) => {
      if (get().isOrbitLocked === v) return;
      if (!v) { set({ isOrbitLocked: false }); return; }
      const zone = get().activeZone;
      const visited = get().visitedDossiers;
      if (zone && PLANET_IDS.includes(zone) && !visited.includes(zone)) {
        const next = [...visited, zone];
        safeSetJSON("fitz-dossiers", next);
        set({ isOrbitLocked: true, isWarping: false, visitedDossiers: next });
      } else {
        set({ isOrbitLocked: true, isWarping: false });
      }
      // Logbook essential: docking at the contact portal.
      if (zone === "contact") get().recordBadge("contact");
    },
    setWarping: (v) => { if (get().isWarping !== v) set({ isWarping: v }); },
    setNearSpawn: (v) => { if (get().isNearSpawn !== v) set({ isNearSpawn: v }); },
    setCometNear: (v) => { if (get().cometNear !== v) set({ cometNear: v }); },
    // The manual lock applies at once, so an automatic decline arriving during
    // warm-up is still refused; only the tier itself waits (pendingLowPerf).
    setLowPerf: (v, manual = false) =>
      set((s) => s.warmingUp
        ? { pendingLowPerf: v, lowPerfManual: s.lowPerfManual || manual }
        : { isLowPerf: v, pendingLowPerf: null, lowPerfManual: s.lowPerfManual || manual }),
    // Clearing the lock on the way IN (not just tracked as a side effect of
    // GlobalCanvas unmounting) closes a mount-while-frozen hole: showClassicCV
    // is the only thing that unmounts GlobalCanvas (App.tsx), and until this
    // guard, isOrbitLocked survived that unmount untouched. A visitor who
    // opened a dossier, then clicked into the classic resume and back, got a
    // freshly-mounted Canvas whose very first render already had
    // sceneFrozen=true — frameloop="never" from frame one, with no
    // frozen->unfrozen edge for GlobalCanvas's invalidate() effect to ever
    // fire on. That's a blank canvas, not a stale frame, until the visitor
    // closes the dossier. It's also better UX regardless: returning to the
    // cabin shouldn't drop the visitor back into a modal they opened before
    // reading the résumé.
    setShowClassicCV: (v) => {
      if (v) get().breakOrbit();
      // The ship unmounts with the canvas, so nothing else would clear warp.
      set(v ? { showClassicCV: true, isWarping: false } : { showClassicCV: false });
    },
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
    sendBroadcast: (text, opts) => set({ broadcast: { id: (get().broadcast?.id ?? 0) + 1, text, silent: opts?.silent ?? false, at: Date.now() } }),
    startWorldEvent: (ev, line) => {
      set({ worldEvent: ev });
      get().sendBroadcast(line);
    },
    endWorldEvent: () => { if (get().worldEvent) set({ worldEvent: null }); },
    bumpImpact: () => set({ impactCount: get().impactCount + 1 }),
    setScanTarget: (v) => { if (get().scanTarget !== v) set({ scanTarget: v }); },
    setPhotoMode: (v) => set({ photoMode: v }),
    setPadConnected: (v) => set({ padConnected: v }),
    setRace: (race) => set({ race }),
    setRaceBest: (t) => {
      safeSetJSON("fitz-race-best", t);
      set({ raceBest: t });
    },
    setBeacons: (beacons) => set({ beacons }),
    addOwnBeacon: (id) => {
      // Newest 20: enough to recognise your own, bounded in storage.
      const next = [id, ...get().ownBeacons.filter((o) => o !== id)].slice(0, 20);
      safeSetJSON("fitz-own-beacons", next);
      set({ ownBeacons: next });
    },
    setBeaconPickerOpen: (v) => set({ beaconPickerOpen: v }),
    setReducedMotion: (v, manual = false) => {
      if (manual) safeSetReducedMotion(v);
      // Ambient motion is the inverse of reduced motion.
      setAmbientEnabled(!v);
      set((s) => ({ reducedMotion: v, reducedMotionManual: s.reducedMotionManual || manual }));
    },
  }))
);

/**
 * True when an opaque modal covers the scene and rendering it is wasted work.
 *
 * Photo mode is deliberately excluded: OrbitControls needs continuous frames
 * to damp a drag, and photo mode has no modal over the canvas anyway.
 * Proximity alone is excluded too -- the tooltip is a small strip, and the
 * visitor is still flying.
 */
export function selectSceneFrozen(
  s: Pick<SpaceState, "isOrbitLocked" | "photoMode">,
): boolean {
  return s.isOrbitLocked && !s.photoMode;
}

/**
 * The world-event director's clock (flying seconds), written once per frame by
 * WorldEventDirector. Mutable outside React, like `flight`, so event
 * animations read it per frame without a subscription.
 */
export const worldClock = { now: 0 };

/** Seconds since the running event of `kind` started, or null if none is running. */
export function worldEventElapsed(kind: WorldEventKind): number | null {
  const ev = useSpaceStore.getState().worldEvent;
  return ev && ev.kind === kind ? worldClock.now - ev.startedAt : null;
}
