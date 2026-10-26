import { parseRaceBest, type RaceState } from "../../utils/race";
import { isBodyId, type BodyId } from "../../data/bodyIds";
import { loadCharted, coversLegacyWorlds, LEGACY_CARTOGRAPHER_KEY, chartLine, isCartographer, SURVEY_LINE, AURUM_LINE, type ChartRecord } from "../../utils/charting";
import { STORE_KEYS, safeGetFlag, safeSetFlag, safeGetJSON, safeSetJSON, loadShards, todayStamp } from "../persist";
import type { SliceCreator } from "../spaceStore";

/** The pilot's progress: data shards, charted bodies (and the AURUM unlock), and the time trial. */
export interface ProgressSlice {
  shardsCollected: number[];
  collectShard: (i: number) => void;
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
  /** Time-trial progress (RingCourse.tsx). Changes only at gates, never per frame. */
  race: RaceState;
  setRace: (r: RaceState) => void;
  /** Best lap in seconds, persisted; null until the first finish. */
  raceBest: number | null;
  setRaceBest: (t: number) => void;
}

/**
 * Charted bodies from fitz-charted, read once at import (sanitised; the five
 * legacy world ids become their real bodies, charting.ts loadCharted). The
 * key is rewritten in the new ids on the next charting write. The logbook
 * slice reads these two for the stored plume's check.
 */
const rawCharted = safeGetJSON<unknown>(STORE_KEYS.charted, []);
export const initialCharted = loadCharted(rawCharted);
/**
 * A pilot whose stored records covered all five legacy worlds earned the title
 * before the real Solar System: they stay cartographers with AURUM at 5/9.
 * Written once, at load, and never cleared (charting.ts LEGACY_CARTOGRAPHER_KEY).
 */
export const initialLegacyCartographer = (() => {
  if (safeGetFlag(LEGACY_CARTOGRAPHER_KEY, false)) return true;
  if (!coversLegacyWorlds(rawCharted)) return false;
  safeSetFlag(LEGACY_CARTOGRAPHER_KEY, true);
  return true;
})();
const initialShout = (() => {
  const v = safeGetJSON<unknown>(STORE_KEYS.chartShout, null);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
})();

/** Cross-slice: chartWorld and tellAurumOnce announce through the logbook slice's announceLogbook. */
export const createProgressSlice: SliceCreator<ProgressSlice> = (set, get) => ({
  shardsCollected: loadShards(safeGetJSON<unknown>(STORE_KEYS.shards, [])),
  collectShard: (i) => {
    const cur = get().shardsCollected;
    if (cur.includes(i)) return;
    const next = [...cur, i];
    set({ shardsCollected: next });
    safeSetJSON(STORE_KEYS.shards, next);
  },
  charted: initialCharted,
  legacyCartographer: initialLegacyCartographer,
  chartWorld: (id) => {
    if (!isBodyId(id) || get().charted.some((c) => c.id === id)) return;
    const next = [...get().charted, { id, at: todayStamp() }];
    safeSetJSON(STORE_KEYS.charted, next);
    set({ charted: next });
    get().announceLogbook(chartLine(id, next.length));
    if (isCartographer(next)) {
      get().announceLogbook(SURVEY_LINE);
      get().announceLogbook(AURUM_LINE);
      safeSetFlag(STORE_KEYS.aurumTold, true);
      set({ aurumTold: true });
      // The live sky tells everyone else, once (Ghosts.tsx).
      const at = Date.now();
      safeSetJSON(STORE_KEYS.chartShout, at);
      set({ chartShoutAt: at });
    }
  },
  chartShoutAt: initialShout,
  clearChartShout: () => {
    safeSetJSON(STORE_KEYS.chartShout, null);
    set({ chartShoutAt: null });
  },
  aurumTold: safeGetFlag(STORE_KEYS.aurumTold, false),
  tellAurumOnce: () => {
    const s = get();
    if (s.aurumTold || !isCartographer(s.charted, s.legacyCartographer)) return;
    s.announceLogbook(AURUM_LINE);
    safeSetFlag(STORE_KEYS.aurumTold, true);
    set({ aurumTold: true });
  },
  race: { phase: "idle" },
  setRace: (race) => set({ race }),
  raceBest: parseRaceBest(safeGetJSON<unknown>(STORE_KEYS.raceBest, null)),
  setRaceBest: (t) => {
    safeSetJSON(STORE_KEYS.raceBest, t);
    set({ raceBest: t });
  },
});
