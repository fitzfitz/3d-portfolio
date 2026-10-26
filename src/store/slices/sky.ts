import { parseBottle, OWN_BOTTLES_KEPT, type Bottle } from "../../utils/beacons";
import { STORE_KEYS, safeGetFlag, safeSetFlag, safeGetJSON, safeSetJSON } from "../persist";
import type { SliceCreator } from "../spaceStore";

/** Visitors' bottles (the beacon API keeps its old name) and the live sky (other pilots). */
export interface SkySlice {
  /**
   * The bottles shown: the newest 30 plus this visitor's own (mergeBottles).
   * Empty when the API is not configured or Show bottles was off from the start.
   */
  beacons: Bottle[];
  setBeacons: (b: Bottle[]) => void;
  /** Ids of beacons and bottles this browser dropped, persisted, so they render as "yours". */
  ownBeacons: string[];
  /**
   * This browser's own bottles in full (fitz-own-bottles, newest
   * OWN_BOTTLES_KEPT), so they show even outside the newest 30.
   */
  ownBottles: Bottle[];
  /** Remembers a bottle this browser dropped, in ownBottles and ownBeacons. */
  addOwnBottle: (b: Bottle) => void;
  /** Show bottles (persisted as fitz-bottles, default on). Off: nothing is fetched, drawn or read. Writing still works. */
  showBottles: boolean;
  setShowBottles: (v: boolean) => void;
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
}

export const createSkySlice: SliceCreator<SkySlice> = (set, get) => ({
  beacons: [],
  setBeacons: (beacons) => set({ beacons }),
  ownBeacons: (() => {
    const raw = safeGetJSON<unknown>(STORE_KEYS.ownBeacons, []);
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  })(),
  ownBottles: (() => {
    // Stored by this browser, but storage is still untrusted input: parse like the API's rows.
    const raw = safeGetJSON<unknown>(STORE_KEYS.ownBottles, []);
    return Array.isArray(raw)
      ? raw.map(parseBottle).filter((b): b is Bottle => b !== null).slice(0, OWN_BOTTLES_KEPT)
      : [];
  })(),
  addOwnBottle: (b) => {
    // Ids: newest 20, enough to recognise your own (older ids are legacy beacons), bounded in storage.
    const ids = [b.id, ...get().ownBeacons.filter((o) => o !== b.id)].slice(0, 20);
    safeSetJSON(STORE_KEYS.ownBeacons, ids);
    const bottles = [b, ...get().ownBottles.filter((o) => o.id !== b.id)].slice(0, OWN_BOTTLES_KEPT);
    safeSetJSON(STORE_KEYS.ownBottles, bottles);
    set({ ownBeacons: ids, ownBottles: bottles });
  },
  showBottles: safeGetFlag(STORE_KEYS.showBottles, true),
  setShowBottles: (v) => {
    set({ showBottles: v });
    safeSetFlag(STORE_KEYS.showBottles, v);
  },
  liveSky: safeGetFlag(STORE_KEYS.liveSky, true),
  setLiveSky: (v) => {
    set({ liveSky: v });
    safeSetFlag(STORE_KEYS.liveSky, v);
  },
  liveSkySeen: safeGetFlag(STORE_KEYS.liveSkySeen, false),
  setLiveSkySeen: (v) => {
    set({ liveSkySeen: v });
    safeSetFlag(STORE_KEYS.liveSkySeen, v);
  },
});
