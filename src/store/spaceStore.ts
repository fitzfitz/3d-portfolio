import { create } from "zustand";
import { SPAWN } from "../data/spawn";
import { subscribeWithSelector } from "zustand/middleware";
import { parseRaceBest, type RaceState } from "../utils/race";
import type { WorldEventKind } from "../utils/eventDirector";
import type { CometPass, ConvoyPlan } from "../utils/worldEvents";
import type { Beacon } from "../utils/beacons";
import { projects } from "../constants";
import { PROBES, PROBE_IDS } from "../data/probes";
import { loadProbeSpots, nextSpot, type ProbeTip } from "../utils/probes";
import { isBodyId, type BodyId } from "../data/bodyIds";
import { SOLAR_BODIES } from "../data/solarSystem";
import { destinationById } from "../data/destinations";
import { bodyPositionAt } from "../utils/bodyPositions";
import { REDUCED_MOTION_QUERY, resolveReducedMotion } from "../utils/reducedMotionPreference";
import { setAmbientEnabled } from "../utils/ambientTime";
import { FUEL_MAX } from "../utils/fuel";
import { isRecordable, badgeLine, plumeAllowed, LOGBOOK, type BadgeRecord } from "../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../data/plumeColors";
import { hasWebGL, wantsResume, WEBGL_AVAILABLE } from "../utils/flightGate";
import { setLowPerfSource } from "../utils/hiResMaps";
import { CHANGELOG } from "../data/changelog";
import { loadCharted, coversLegacyWorlds, LEGACY_CARTOGRAPHER_KEY, chartLine, isCartographer, SURVEY_LINE, AURUM_LINE, type ChartRecord } from "../utils/charting";
import {
  safeGetMuted, safeSetMuted, safeGetFlag, safeSetFlag, safeGetReducedMotion, safeSetReducedMotion,
  safeGetJSON, safeSetJSON, loadVisitedDossiers as loadVisitedDossiersFor, todayStamp, loadBadges, loadShards,
} from "./persist";

const PROJECT_IDS: readonly string[] = projects.map((p) => p.id);

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

export { todayStamp, loadBadges, loadShards };

const loadVisitedDossiers = () => loadVisitedDossiersFor(PROJECT_IDS);

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

export { hasWebGL, wantsResume, WEBGL_AVAILABLE };

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
   * drain while warping) and by FuelCrystals' pickup (discrete refuel on
   * collection), and read by the HUD/radar rAF loops. Deliberately here
   * rather than in the store: it changes every frame while warping, and store
   * state would make that a per-frame React commit, breaking the
   * zero-renders-during-flight guarantee.
   * Starts full — fuel is session state, not persisted progress.
   */
  fuel: FUEL_MAX,
  /** The return burn is running this frame (Spaceship writes it; EdgeHaze reads it for the radio line). */
  edgeBurn: false,
};

/**
 * Live positions of the nine bodies, by body id, written once per frame by
 * SolarBodies' useFrame (utils/bodyPositions.ts updateBodies) and read by
 * Spaceship (wells, collisions), RadarMap, HUD, and the scannable registry.
 * Mutable outside React — same pattern as `flight`. Seeded at game time 0.
 */
export const bodies: Record<BodyId, { x: number; y: number; z: number }> = Object.fromEntries(
  SOLAR_BODIES.map((b) => [b.id, bodyPositionAt(b, 0, { x: 0, y: 0, z: 0 })] as const),
) as Record<BodyId, { x: number; y: number; z: number }>;

/**
 * Charted bodies from fitz-charted, read once at import (sanitised; the five
 * legacy world ids become their real bodies, charting.ts loadCharted). The
 * key is rewritten in the new ids on the next charting write.
 */
const rawCharted = safeGetJSON<unknown>("fitz-charted", []);
const initialCharted = loadCharted(rawCharted);
/**
 * A pilot whose stored records covered all five legacy worlds earned the title
 * before the real Solar System: they stay cartographers with AURUM at 5/9.
 * Written once, at load, and never cleared (charting.ts LEGACY_CARTOGRAPHER_KEY).
 */
const initialLegacyCartographer = (() => {
  if (safeGetFlag(LEGACY_CARTOGRAPHER_KEY, false)) return true;
  if (!coversLegacyWorlds(rawCharted)) return false;
  safeSetFlag(LEGACY_CARTOGRAPHER_KEY, true);
  return true;
})();
const initialShout = (() => {
  const v = safeGetJSON<unknown>("fitz-charted-shout", null);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
})();

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

/** The running world event (docs/archive/specs/2026-10-12-world-events-design.md). */
export interface WorldEventState {
  kind: WorldEventKind;
  id: number;
  /** Director clock (flying seconds) at start; compare with worldClock.now. */
  startedAt: number;
  comet?: CometPass;
  /** The body the convoy delivers to (its `bodies` key). */
  convoy?: { planet: BodyId; plan: ConvoyPlan };
}

export interface SpaceState {
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
  /** The canvas's React key: remountCanvas bumps it for a fresh WebGL context. */
  canvasEpoch: number;
  isNearSpawn: boolean;
  isTeleporting: boolean;
  isMuted: boolean;
  cometNear: boolean;
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
   * Pending jump to a planet id or a destination id (src/data/destinations.ts),
   * consumed by Spaceship's frame loop. `seq` makes a repeat request for the
   * same target a new value.
   */
  jumpRequest: { id: string; seq: number } | null;
  requestJump: (id: string) => void;
  /** Project id whose dossier popup is open (independent of the orbit lock). */
  openDossier: string | null;
  dossierVia: "probe" | "logbook" | null;
  /** Each probe's current spot (0 = home, k = remote[k-1]); persisted as fitz-probes. */
  probeSpots: Record<string, number>;
  /** Set when a probe's dossier closes; consumed by ProjectProbes to play the burn. */
  relocation: { id: string; seq: number } | null;
  /** Nearest probe within PROBE_IN_RANGE (written by ProjectProbes, change-guarded). */
  probeNear: string | null;
  /** The HUD pickup tip for probeNear: "grab" only when the beam would take a probe (ProjectProbes, change-guarded). */
  probeTip: ProbeTip;
  openProjectDossier: (id: string, via: "probe" | "logbook") => void;
  closeDossier: () => void;
  setProbeNear: (id: string | null) => void;
  setProbeTip: (tip: ProbeTip) => void;
  setSceneReady: (v: boolean) => void;
  setFuelEmpty: (v: boolean) => void;
  setActiveZone: (z: string | null) => void;
  setOrbitLocked: (v: boolean) => void;
  breakOrbit: () => void;
  setWarping: (v: boolean) => void;
  setLowPerf: (v: boolean, manual?: boolean) => void;
  setShowClassicCV: (v: boolean) => void;
  /**
   * Mounts a new canvas in place of the current one, as the classic-résumé
   * round trip does: GlobalCanvas calls it when a lost WebGL context comes
   * back, since the scene's images were released after upload (sceneAssets.ts)
   * and three cannot re-upload from them.
   */
  remountCanvas: () => void;
  setNearSpawn: (v: boolean) => void;
  triggerTeleportFlash: () => void;
  setMuted: (v: boolean) => void;
  setCometNear: (v: boolean) => void;
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
  /** Live sky on (persisted as fitz-live-sky, default on): share this ship and see other pilots. */
  liveSky: boolean;
  setLiveSky: (v: boolean) => void;
  /**
   * The live-sky notice has been on the radio (persisted as fitz-live-seen-2:
   * versioned when the notice grew the charted count, so pilots who agreed to
   * the old one hear the new one once). No pose is sent before it.
   */
  liveSkySeen: boolean;
  setLiveSkySeen: (v: boolean) => void;
  /** Bodies charted (persisted as fitz-charted, never fitz-logbook). The CARTOGRAPHER title is derived from it. */
  charted: ChartRecord[];
  /** Earned the title before the real Solar System (charting.ts LEGACY_CARTOGRAPHER_KEY): cartographer at 5/9, never cleared. */
  legacyCartographer: boolean;
  /**
   * Charts a body on its first scan (Scanner.tsx); a repeat is a no-op.
   * Persists (in the new ids, so a legacy record is rewritten) and announces through announceLogbook, so
   * the line queues behind the scan report; the last also announces the survey.
   */
  chartWorld: (id: BodyId) => void;
  /**
   * When the last body was charted, until the live sky has announced it
   * (persisted as fitz-charted-shout; see shoutDue). Null when nothing is due.
   */
  chartShoutAt: number | null;
  /** The shout-out went out (or is dropped): stop offering it. */
  clearChartShout: () => void;
  /** The AURUM unlock has been on the radio (persisted as fitz-aurum-told). */
  aurumTold: boolean;
  /**
   * Plays AURUM_LINE once for a pilot who already holds the title but never
   * heard it (charted all five before AURUM existed). App calls it when the
   * scene is ready; a no-op otherwise.
   */
  tellAurumOnce: () => void;
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
  return typeof raw === "string" && plumeAllowed(raw, progress, hasPlumeColour, initialCharted, initialLegacyCartographer) ? raw : "stock";
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
      if (!plumeAllowed(id, progress, hasPlumeColour, s.charted, s.legacyCartographer) || s.plumeColor === id) return;
      safeSetJSON("fitz-plume", id);
      set({ plumeColor: id });
    },
    setLogbookOpen: (v) => {
      if (get().logbookOpen === v) return;
      set(v ? { logbookOpen: true, changelogOpen: false } : { logbookOpen: false });
    },
    charted: initialCharted,
    legacyCartographer: initialLegacyCartographer,
    chartWorld: (id) => {
      if (!isBodyId(id) || get().charted.some((c) => c.id === id)) return;
      const next = [...get().charted, { id, at: todayStamp() }];
      safeSetJSON("fitz-charted", next);
      set({ charted: next });
      get().announceLogbook(chartLine(id, next.length));
      if (isCartographer(next)) {
        get().announceLogbook(SURVEY_LINE);
        get().announceLogbook(AURUM_LINE);
        safeSetFlag("fitz-aurum-told", true);
        set({ aurumTold: true });
        // The live sky tells everyone else, once (Ghosts.tsx).
        const at = Date.now();
        safeSetJSON("fitz-charted-shout", at);
        set({ chartShoutAt: at });
      }
    },
    chartShoutAt: initialShout,
    aurumTold: safeGetFlag("fitz-aurum-told", false),
    tellAurumOnce: () => {
      const s = get();
      if (s.aurumTold || !isCartographer(s.charted, s.legacyCartographer)) return;
      s.announceLogbook(AURUM_LINE);
      safeSetFlag("fitz-aurum-told", true);
      set({ aurumTold: true });
    },
    clearChartShout: () => {
      safeSetJSON("fitz-charted-shout", null);
      set({ chartShoutAt: null });
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
    canvasEpoch: 0,
    isNearSpawn: true,
    isTeleporting: false,
    isMuted: safeGetMuted(),
    liveSky: safeGetFlag("fitz-live-sky", true),
    liveSkySeen: safeGetFlag("fitz-live-seen-2", false),
    cometNear: false,
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
    openDossier: null,
    dossierVia: null,
    probeSpots: loadProbeSpots(safeGetJSON<unknown>("fitz-probes", null)),
    relocation: null,
    probeNear: null,
    probeTip: null,
    // Records the visit as setOrbitLocked once did. The popup freezes the frame
    // loop, so clear isWarping here too or the warp drone outlives the boost.
    openProjectDossier: (id, via) => {
      if (!PROJECT_IDS.includes(id) || get().openDossier !== null) return;
      const visited = get().visitedDossiers;
      if (visited.includes(id)) {
        set({ openDossier: id, dossierVia: via, isWarping: false });
        return;
      }
      const next = [...visited, id];
      safeSetJSON("fitz-dossiers", next);
      set({ openDossier: id, dossierVia: via, isWarping: false, visitedDossiers: next });
    },
    closeDossier: () => {
      const { openDossier, dossierVia, probeSpots, relocation } = get();
      if (openDossier === null) return;
      const def = dossierVia === "probe" ? PROBES.find((p) => p.id === openDossier) : undefined;
      if (!def) { set({ openDossier: null, dossierVia: null }); return; }
      const spots = { ...probeSpots, [def.id]: nextSpot(def, probeSpots[def.id] ?? 0) };
      // Persist before the burn plays: a reload mid-animation must not undo it.
      safeSetJSON("fitz-probes", spots);
      set({ openDossier: null, dossierVia: null, probeSpots: spots, relocation: { id: def.id, seq: (relocation?.seq ?? 0) + 1 } });
    },
    setProbeNear: (id) => { if (get().probeNear !== id) set({ probeNear: id }); },
    setProbeTip: (tip) => { if (get().probeTip !== tip) set({ probeTip: tip }); },
    requestJump: (id) => {
      if (!destinationById(id) && !PROBE_IDS.includes(id)) return;
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
    setOrbitLocked: (v) => {
      if (get().isOrbitLocked === v) return;
      if (!v) { set({ isOrbitLocked: false }); return; }
      const zone = get().activeZone;
      set({ isOrbitLocked: true, isWarping: false });
      // Logbook essential: docking at a destination records the badge named
      // after it (recordBadge ignores ids the logbook does not list).
      const dest = destinationById(zone);
      if (dest) get().recordBadge(dest.id);
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
      if (v) { get().breakOrbit(); get().closeDossier(); }
      // The ship unmounts with the canvas, so nothing else would clear warp.
      set(v ? { showClassicCV: true, isWarping: false } : { showClassicCV: false });
    },
    // Same guards as the round trip's way in: a canvas must not mount frozen.
    remountCanvas: () => {
      get().breakOrbit();
      get().closeDossier();
      set((s) => ({ canvasEpoch: s.canvasEpoch + 1, isWarping: false }));
    },
    setLiveSky: (v) => {
      set({ liveSky: v });
      safeSetFlag("fitz-live-sky", v);
    },
    setLiveSkySeen: (v) => {
      set({ liveSkySeen: v });
      safeSetFlag("fitz-live-seen-2", v);
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

// hiResMaps reads low-perf from here from now on (it cannot import the store; see there).
setLowPerfSource(() => useSpaceStore.getState().isLowPerf);

/**
 * True when an opaque modal covers the scene and rendering it is wasted work.
 *
 * Photo mode is deliberately excluded: OrbitControls needs continuous frames
 * to damp a drag, and photo mode has no modal over the canvas anyway.
 * Proximity alone is excluded too -- the tooltip is a small strip, and the
 * visitor is still flying.
 */
export function selectSceneFrozen(
  s: Pick<SpaceState, "isOrbitLocked" | "openDossier" | "photoMode">,
): boolean {
  return selectModalOpen(s) && !s.photoMode;
}

/** A modal covers the scene: an orbit-locked dock panel or a dossier popup. */
export function selectModalOpen(s: Pick<SpaceState, "isOrbitLocked" | "openDossier">): boolean {
  return s.isOrbitLocked || s.openDossier !== null;
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
