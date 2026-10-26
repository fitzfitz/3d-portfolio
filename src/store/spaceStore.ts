import { create, type StateCreator } from "zustand";

import { worldClock } from "./worldClock";
import { subscribeWithSelector } from "zustand/middleware";
import type { WorldEventKind } from "../utils/eventDirector";
import type { CometPass, ConvoyPlan } from "../utils/worldEvents";
import { projects } from "../constants";
import { PROBES, PROBE_IDS } from "../data/probes";
import { loadProbeSpots, nextSpot, type ProbeTip } from "../utils/probes";
import type { BodyId } from "../data/bodyIds";
import { destinationById } from "../data/destinations";
import { isRecordable, badgeLine, plumeAllowed, LOGBOOK, type BadgeRecord } from "../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../data/plumeColors";
import { hasWebGL, wantsResume, WEBGL_AVAILABLE } from "../utils/flightGate";
import { setLowPerfSource } from "../utils/hiResMaps";
import {
  safeGetJSON, safeSetJSON, loadVisitedDossiers as loadVisitedDossiersFor, todayStamp, loadBadges, loadShards,

} from "./persist";
import { createProgressSlice, initialCharted, initialLegacyCartographer, type ProgressSlice } from "./slices/progress";
import { createSettingsSlice, type SettingsSlice } from "./slices/settings";
import { createSkySlice, type SkySlice } from "./slices/sky";

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


export { hasWebGL, wantsResume, WEBGL_AVAILABLE };

// Per-frame objects, mutable outside React. Same objects, re-exported: importers keep using this path.
export { flight, type FlightInput } from "./flightState";
export { bodies } from "./bodies";
export { crystalSlots, type CrystalSlot } from "./crystalSlots";
export { worldClock } from "./worldClock";


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

/** A zustand slice creator over the whole store (zustand's slices pattern; see slices/). */
export type SliceCreator<T> = StateCreator<SpaceState, [["zustand/subscribeWithSelector", never]], [], T>;

export interface SpaceState extends ProgressSlice, SettingsSlice, SkySlice {
  activeZone: string | null;
  isOrbitLocked: boolean;
  isOrbitCooldown: boolean;
  isWarping: boolean;
  worldEvent: WorldEventState | null;
  showClassicCV: boolean;
  /** The canvas's React key: remountCanvas bumps it for a fresh WebGL context. */
  canvasEpoch: number;
  isNearSpawn: boolean;
  isTeleporting: boolean;
  cometNear: boolean;
  /** The latest radio line; `at` (Date.now) lets a badge line wait for a fresh one to be read. */
  broadcast: { id: number; text: string; silent: boolean; at: number } | null;
  impactCount: number;
  scanTarget: string | null;
  photoMode: boolean;
  /** A gamepad has reported in (it does only after its first button press). */
  padConnected: boolean;
  beaconPickerOpen: boolean;
  fuelEmpty: boolean;
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
  setFuelEmpty: (v: boolean) => void;
  setActiveZone: (z: string | null) => void;
  setOrbitLocked: (v: boolean) => void;
  breakOrbit: () => void;
  setWarping: (v: boolean) => void;
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
  setCometNear: (v: boolean) => void;
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
  setBeaconPickerOpen: (v: boolean) => void;
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
}


const initialBadges = loadBadges(safeGetJSON<unknown>("fitz-logbook", []));
const initialPlume = (() => {
  const raw = safeGetJSON<unknown>("fitz-plume", "stock");
  const progress = { visitedDossiers: loadVisitedDossiers(), shardsCollected: loadShards(safeGetJSON<unknown>("fitz-shards", [])), badges: initialBadges };
  return typeof raw === "string" && plumeAllowed(raw, progress, hasPlumeColour, initialCharted, initialLegacyCartographer) ? raw : "stock";
})();

export const useSpaceStore = create<SpaceState>()(
  subscribeWithSelector((set, get, api) => ({
    ...createProgressSlice(set, get, api),
    ...createSettingsSlice(set, get, api),
    ...createSkySlice(set, get, api),
    activeZone: null,
    isOrbitLocked: false,
    isOrbitCooldown: false,
    isWarping: false,
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
    changelogOpen: false,
    setChangelogOpen: (v) => {
      if (get().changelogOpen === v) return;
      set(v ? { changelogOpen: true, logbookOpen: false } : { changelogOpen: false });
    },
    // No WebGL means no scene: start on the résumé rather than a blank page.
    showClassicCV: !WEBGL_AVAILABLE || wantsResume(),
    canvasEpoch: 0,
    isNearSpawn: true,
    isTeleporting: false,
    cometNear: false,
    broadcast: null,
    impactCount: 0,
    scanTarget: null,
    photoMode: false,
    padConnected: false,
    beaconPickerOpen: false,
    fuelEmpty: false,
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
    setBeaconPickerOpen: (v) => set({ beaconPickerOpen: v }),
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

/** Seconds since the running event of `kind` started, or null if none is running. */
export function worldEventElapsed(kind: WorldEventKind): number | null {
  const ev = useSpaceStore.getState().worldEvent;
  return ev && ev.kind === kind ? worldClock.now - ev.startedAt : null;
}
