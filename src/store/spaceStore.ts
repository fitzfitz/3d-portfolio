import { create, type StateCreator } from "zustand";

import { worldClock } from "./worldClock";
import { subscribeWithSelector } from "zustand/middleware";
import type { WorldEventKind } from "../utils/eventDirector";
import type { CometPass, ConvoyPlan } from "../utils/worldEvents";
import type { BodyId } from "../data/bodyIds";
import { isRecordable, badgeLine, plumeAllowed, LOGBOOK, type BadgeRecord } from "../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../data/plumeColors";
import { hasWebGL, wantsResume, WEBGL_AVAILABLE } from "../utils/flightGate";
import { setLowPerfSource } from "../utils/hiResMaps";
import {
  safeGetJSON, safeSetJSON, todayStamp, loadBadges, loadShards,
} from "./persist";
import { createFlightSlice, type FlightSlice } from "./slices/flight";
import { createDossierSlice, loadVisitedDossiers, type DossierSlice } from "./slices/dossier";
import { createProgressSlice, initialCharted, initialLegacyCartographer, type ProgressSlice } from "./slices/progress";
import { createSettingsSlice, type SettingsSlice } from "./slices/settings";
import { createSkySlice, type SkySlice } from "./slices/sky";

/**
 * A badge earned in the same moment as its payoff (a scan report, a lap time)
 * must not cut that line off: RadioChatter's single typewriter line cancels
 * whatever it is typing. Same delay as the shard-completion fanfare.
 */
const BADGE_LINE_HOLD_MS = 3000;
const BADGE_LINE_DELAY_MS = 4500;

export { todayStamp, loadBadges, loadShards };


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

export interface SpaceState extends FlightSlice, DossierSlice, ProgressSlice, SettingsSlice, SkySlice {
  worldEvent: WorldEventState | null;
  showClassicCV: boolean;
  /** The canvas's React key: remountCanvas bumps it for a fresh WebGL context. */
  canvasEpoch: number;
  cometNear: boolean;
  /** The latest radio line; `at` (Date.now) lets a badge line wait for a fresh one to be read. */
  broadcast: { id: number; text: string; silent: boolean; at: number } | null;
  scanTarget: string | null;
  photoMode: boolean;
  /** A gamepad has reported in (it does only after its first button press). */
  padConnected: boolean;
  beaconPickerOpen: boolean;
  setShowClassicCV: (v: boolean) => void;
  /**
   * Mounts a new canvas in place of the current one, as the classic-résumé
   * round trip does: GlobalCanvas calls it when a lost WebGL context comes
   * back, since the scene's images were released after upload (sceneAssets.ts)
   * and three cannot re-upload from them.
   */
  remountCanvas: () => void;
  setCometNear: (v: boolean) => void;
  /**
   * Shows a line on the radio. `silent` lines (cargo hails, flavour such as
   * the haze and slingshot callouts) are not announced to screen readers:
   * the aria-live region is for content a visitor acted to get.
   */
  sendBroadcast: (text: string, opts?: { silent?: boolean }) => void;
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
    ...createFlightSlice(set, get, api),
    ...createDossierSlice(set, get, api),
    ...createProgressSlice(set, get, api),

    ...createSettingsSlice(set, get, api),
    ...createSkySlice(set, get, api),
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
    cometNear: false,
    broadcast: null,
    scanTarget: null,
    photoMode: false,
    padConnected: false,
    beaconPickerOpen: false,
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
    sendBroadcast: (text, opts) => set({ broadcast: { id: (get().broadcast?.id ?? 0) + 1, text, silent: opts?.silent ?? false, at: Date.now() } }),
    startWorldEvent: (ev, line) => {
      set({ worldEvent: ev });
      get().sendBroadcast(line);
    },
    endWorldEvent: () => { if (get().worldEvent) set({ worldEvent: null }); },
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
