import type { Beacon } from "../../utils/beacons";
import { STORE_KEYS, safeGetFlag, safeSetFlag, safeGetJSON, safeSetJSON } from "../persist";
import type { SliceCreator } from "../spaceStore";

/** Visitor beacons and the live sky (other pilots). */
export interface SkySlice {
  /** Visitor beacons from the beacon API (empty when it is not configured). */
  beacons: Beacon[];
  setBeacons: (b: Beacon[]) => void;
  /** Ids of beacons this browser dropped, persisted, so they render as "yours". */
  ownBeacons: string[];
  addOwnBeacon: (id: string) => void;
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
  addOwnBeacon: (id) => {
    // Newest 20: enough to recognise your own, bounded in storage.
    const next = [id, ...get().ownBeacons.filter((o) => o !== id)].slice(0, 20);
    safeSetJSON(STORE_KEYS.ownBeacons, next);
    set({ ownBeacons: next });
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
