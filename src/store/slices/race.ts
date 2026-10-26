import { parseRaceBest } from "../../utils/race";
import { RACE_IDLE, type RaceView } from "../../utils/raceSession";
import { STORE_KEYS, safeGetJSON, safeSetJSON, safeRemove } from "../persist";
import type { SliceCreator } from "../spaceStore";

/** The old time trial's best-lap ghost: the race replays the server's best lap now. Deleted once at load. */
export const LEGACY_RACE_GHOST_KEY = "fitz-race-ghost";

/** The ring race: what the HUD and the scene show, the live sky it turned on, and the best lap. */
export interface RaceSlice {
  /** The race as the server last told it (raceSession.ts raceReduce, through raceController.ts). */
  raceView: RaceView;
  /**
   * Sets the view. Back to idle, it turns the live sky off again when joining
   * the race turned it on (raceLiveSkyRestore), and clears that flag.
   */
  setRaceView: (v: RaceView) => void;
  /** Joining a race turned the live sky on; turn it off when the race is over. In memory only. */
  raceLiveSkyRestore: boolean;
  setRaceLiveSkyRestore: (v: boolean) => void;
  /** Best lap in seconds, persisted; null until the first finish. */
  raceBest: number | null;
  setRaceBest: (t: number) => void;
}

safeRemove(LEGACY_RACE_GHOST_KEY);

/** Cross-slice: setRaceView calls the sky slice's setLiveSky. */
export const createRaceSlice: SliceCreator<RaceSlice> = (set, get) => ({
  raceView: RACE_IDLE,
  setRaceView: (v) => {
    if (v.phase === "idle" && get().raceLiveSkyRestore) {
      set({ raceView: v, raceLiveSkyRestore: false });
      if (get().liveSky) get().setLiveSky(false);
      return;
    }
    set({ raceView: v });
  },
  raceLiveSkyRestore: false,
  setRaceLiveSkyRestore: (v) => set({ raceLiveSkyRestore: v }),
  raceBest: parseRaceBest(safeGetJSON<unknown>(STORE_KEYS.raceBest, null)),
  setRaceBest: (t) => {
    safeSetJSON(STORE_KEYS.raceBest, t);
    set({ raceBest: t });
  },
});
