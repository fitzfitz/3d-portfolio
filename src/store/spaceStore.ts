import { create, type StateCreator } from "zustand";

import { worldClock } from "./worldClock";
import { subscribeWithSelector } from "zustand/middleware";
import type { WorldEventKind } from "../utils/eventDirector";
import { hasWebGL, wantsResume, WEBGL_AVAILABLE } from "../utils/flightGate";
import { setLowPerfSource } from "../utils/hiResMaps";
import { todayStamp, loadBadges, loadShards } from "./persist";
import { createFlightSlice, type FlightSlice } from "./slices/flight";
import { createDossierSlice, type DossierSlice } from "./slices/dossier";
import { createHudSlice, type HudSlice } from "./slices/hud";
import { createLogbookSlice, type LogbookSlice } from "./slices/logbook";
import { createProgressSlice, type ProgressSlice } from "./slices/progress";
import { createSettingsSlice, type SettingsSlice } from "./slices/settings";
import { createSkySlice, type SkySlice } from "./slices/sky";

export { todayStamp, loadBadges, loadShards };


export { hasWebGL, wantsResume, WEBGL_AVAILABLE };

// Per-frame objects, mutable outside React. Same objects, re-exported: importers keep using this path.
export { flight, type FlightInput } from "./flightState";
export { bodies } from "./bodies";
export { crystalSlots, type CrystalSlot } from "./crystalSlots";
export { worldClock } from "./worldClock";
export type { WorldEventState } from "./slices/hud";


/** A zustand slice creator over the whole store (zustand's slices pattern; see slices/). */
export type SliceCreator<T> = StateCreator<SpaceState, [["zustand/subscribeWithSelector", never]], [], T>;

export interface SpaceState extends FlightSlice, DossierSlice, HudSlice, LogbookSlice, ProgressSlice, SettingsSlice, SkySlice {}

export const useSpaceStore = create<SpaceState>()(
  subscribeWithSelector((set, get, api) => ({
    ...createFlightSlice(set, get, api),
    ...createDossierSlice(set, get, api),
    ...createHudSlice(set, get, api),
    ...createLogbookSlice(set, get, api),
    ...createProgressSlice(set, get, api),
    ...createSettingsSlice(set, get, api),
    ...createSkySlice(set, get, api),
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
