/**
 * The game's one zustand store, composed from slices (zustand's slices
 * pattern). Each file in slices/ owns its state type, its actions and its
 * initial values, localStorage reads included; persist.ts holds the storage
 * helpers and keys. Consumers import everything from here, as before.
 *
 * Slices: flight (orbit and dock, warp, jumps), dossier (dossiers, probes),
 * hud (panels, radio, world events), logbook (badges, plume, line queue),
 * progress (shards, charting), race (race view, best lap), settings (perf
 * tier, warm-up, reduced motion, sound, changelog seen), sky (beacons, live sky).
 *
 * Cross-slice actions call the other slice's action through get():
 *   - flight.setOrbitLocked      -> logbook.recordBadge (docking at a destination)
 *   - logbook.recordBadge        -> logbook.announceLogbook -> hud.sendBroadcast
 *                                   (announceLogbook also reads hud.broadcast)
 *   - hud.setShowClassicCV(true) -> flight.breakOrbit + dossier.closeDossier
 *   - hud.remountCanvas          -> flight.breakOrbit + dossier.closeDossier
 *   - progress.chartWorld        -> logbook.announceLogbook
 *   - progress.tellAurumOnce     -> logbook.announceLogbook
 *   - race.setRaceView(idle)     -> sky.setLiveSky(false) (when racing turned it on)
 *   - hud.startWorldEvent        -> hud.sendBroadcast
 *   - logbook.setPlumeColor reads dossier.visitedDossiers and progress
 *     (shardsCollected, charted, legacyCartographer)
 *
 * Cross-slice writes, kept in the writer's own set() as before the split (one
 * notification, not two):
 *   - dossier.openProjectDossier sets flight.isWarping = false
 *   - hud.setShowClassicCV(true) sets flight.isWarping = false
 *   - hud.remountCanvas sets flight.isWarping = false
 *
 * Import-time order: the slice modules' own reads run at import (progress.ts
 * writes the legacy-cartographer flag once; race.ts deletes the old time
 * trial's fitz-race-ghost once; logbook.ts checks the stored plume
 * against the stored dossiers, shards and charting). The settings slice's
 * creator then switches the ambient clock and makes the first-visit changelog
 * write as the store is created. tests/storeShape.test.ts pins all of it.
 */
import { create, type StateCreator } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { WorldEventKind } from "../utils/eventDirector";
import { setLowPerfSource } from "../utils/hiResMaps";
import { worldClock } from "./worldClock";
import { createFlightSlice, type FlightSlice } from "./slices/flight";
import { createDossierSlice, type DossierSlice } from "./slices/dossier";
import { createHudSlice, type HudSlice } from "./slices/hud";
import { createLogbookSlice, type LogbookSlice } from "./slices/logbook";
import { createProgressSlice, type ProgressSlice } from "./slices/progress";
import { createRaceSlice, type RaceSlice } from "./slices/race";
import { createSettingsSlice, type SettingsSlice } from "./slices/settings";
import { createSkySlice, type SkySlice } from "./slices/sky";

export { todayStamp, loadBadges, loadShards } from "./persist";
export { hasWebGL, wantsResume, WEBGL_AVAILABLE } from "../utils/flightGate";
export type { WorldEventState } from "./slices/hud";

// Per-frame objects, mutable outside React. The same objects, re-exported: importers keep using this path.
export { flight, type FlightInput } from "./flightState";
export { bodies } from "./bodies";
export { worldClock } from "./worldClock";

export interface SpaceState
  extends FlightSlice, DossierSlice, HudSlice, LogbookSlice, ProgressSlice, RaceSlice, SettingsSlice, SkySlice {}

/** A slice creator over the whole store: a slice reads and calls the others through get(). */
export type SliceCreator<T> = StateCreator<SpaceState, [["zustand/subscribeWithSelector", never]], [], T>;

export const useSpaceStore = create<SpaceState>()(
  subscribeWithSelector((...a) => ({
    ...createFlightSlice(...a),
    ...createDossierSlice(...a),
    ...createHudSlice(...a),
    ...createLogbookSlice(...a),
    ...createProgressSlice(...a),
    ...createRaceSlice(...a),
    ...createSettingsSlice(...a),
    ...createSkySlice(...a),
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
 * The pilot is mid-lap: the race is running and they have not finished. The
 * quiet-while-racing readers (radio lines, traffic, events, the guide) use it;
 * a finished pilot waiting out the final call hears the world again.
 */
export function selectRaceFlying(s: Pick<SpaceState, "raceView">): boolean {
  return s.raceView.phase === "running" && !s.raceView.finished;
}

/**
 * Seconds since the running event of `kind` started, or null if none is
 * running. Kept here rather than in worldClock.ts: it reads the store, and
 * worldClock.ts importing the store would make an import cycle.
 */
export function worldEventElapsed(kind: WorldEventKind): number | null {
  const ev = useSpaceStore.getState().worldEvent;
  return ev && ev.kind === kind ? worldClock.now - ev.startedAt : null;
}
