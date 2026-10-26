import type { WorldEventKind } from "../../utils/eventDirector";
import type { CometPass, ConvoyPlan } from "../../utils/worldEvents";
import type { BodyId } from "../../data/bodyIds";
import { wantsResume, WEBGL_AVAILABLE } from "../../utils/flightGate";
import type { SliceCreator } from "../spaceStore";

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

/** The HUD and panels: the résumé view, the canvas key, photo mode, the radio, scan and world events. */
export interface HudSlice {
  showClassicCV: boolean;
  setShowClassicCV: (v: boolean) => void;
  /** The canvas's React key: remountCanvas bumps it for a fresh WebGL context. */
  canvasEpoch: number;
  /**
   * Mounts a new canvas in place of the current one, as the classic-résumé
   * round trip does: GlobalCanvas calls it when a lost WebGL context comes
   * back, since the scene's images were released after upload (sceneAssets.ts)
   * and three cannot re-upload from them.
   */
  remountCanvas: () => void;
  photoMode: boolean;
  setPhotoMode: (v: boolean) => void;
  /** A gamepad has reported in (it does only after its first button press). */
  padConnected: boolean;
  setPadConnected: (v: boolean) => void;
  scanTarget: string | null;
  setScanTarget: (v: string | null) => void;
  logbookOpen: boolean;
  setLogbookOpen: (v: boolean) => void;
  changelogOpen: boolean;
  setChangelogOpen: (v: boolean) => void;
  /** The bottle writing panel (B / the BOTTLE button). It owns the keyboard while open. */
  bottlePanelOpen: boolean;
  setBottlePanelOpen: (v: boolean) => void;
  cometNear: boolean;
  setCometNear: (v: boolean) => void;
  /** The latest radio line; `at` (Date.now) lets a badge line wait for a fresh one to be read. */
  broadcast: { id: number; text: string; silent: boolean; at: number } | null;
  /**
   * Shows a line on the radio. `silent` lines (cargo hails, flavour such as
   * the haze and slingshot callouts) are not announced to screen readers:
   * the aria-live region is for content a visitor acted to get.
   */
  sendBroadcast: (text: string, opts?: { silent?: boolean }) => void;
  worldEvent: WorldEventState | null;
  startWorldEvent: (ev: WorldEventState, line: string) => void;
  endWorldEvent: () => void;
}

/**
 * Cross-slice: setShowClassicCV (on the way in) and remountCanvas call the
 * flight slice's breakOrbit and the dossier slice's closeDossier, then clear
 * the flight slice's isWarping in their own set, as before.
 */
export const createHudSlice: SliceCreator<HudSlice> = (set, get) => ({
  // No WebGL means no scene: start on the résumé rather than a blank page.
  showClassicCV: !WEBGL_AVAILABLE || wantsResume(),
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
  canvasEpoch: 0,
  // Same guards as the round trip's way in: a canvas must not mount frozen.
  remountCanvas: () => {
    get().breakOrbit();
    get().closeDossier();
    set((s) => ({ canvasEpoch: s.canvasEpoch + 1, isWarping: false }));
  },
  photoMode: false,
  setPhotoMode: (v) => set({ photoMode: v }),
  padConnected: false,
  setPadConnected: (v) => set({ padConnected: v }),
  scanTarget: null,
  setScanTarget: (v) => { if (get().scanTarget !== v) set({ scanTarget: v }); },
  logbookOpen: false,
  setLogbookOpen: (v) => {
    if (get().logbookOpen === v) return;
    set(v ? { logbookOpen: true, changelogOpen: false } : { logbookOpen: false });
  },
  changelogOpen: false,
  setChangelogOpen: (v) => {
    if (get().changelogOpen === v) return;
    set(v ? { changelogOpen: true, logbookOpen: false } : { changelogOpen: false });
  },
  bottlePanelOpen: false,
  setBottlePanelOpen: (v) => set({ bottlePanelOpen: v }),
  cometNear: false,
  setCometNear: (v) => { if (get().cometNear !== v) set({ cometNear: v }); },
  broadcast: null,
  sendBroadcast: (text, opts) => set({ broadcast: { id: (get().broadcast?.id ?? 0) + 1, text, silent: opts?.silent ?? false, at: Date.now() } }),
  worldEvent: null,
  startWorldEvent: (ev, line) => {
    set({ worldEvent: ev });
    get().sendBroadcast(line);
  },
  endWorldEvent: () => { if (get().worldEvent) set({ worldEvent: null }); },
});
