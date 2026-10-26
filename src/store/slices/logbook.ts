import { isRecordable, badgeLine, plumeAllowed, LOGBOOK, type BadgeRecord } from "../../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../../data/plumeColors";
import { STORE_KEYS, safeGetJSON, safeSetJSON, loadBadges, loadShards, todayStamp } from "../persist";
import { initialCharted, initialLegacyCartographer } from "./progress";
import { loadVisitedDossiers } from "./dossier";
import type { SliceCreator } from "../spaceStore";

/** Logbook badges, the plume colour they unlock, and the queue for logbook lines on the radio. */
export interface LogbookSlice {
  /** Logbook badges earned (persisted as fitz-logbook). Dossiers and shards are derived elsewhere. */
  badges: BadgeRecord[];
  recordBadge: (id: string) => void;
  /** Selected plume colour: "stock" or an unlocked badge id (persisted as fitz-plume). */
  plumeColor: string;
  setPlumeColor: (id: string) => void;
  /** When the radio is next free for a logbook line (ms); logbook lines queue rather than cut each other off. */
  logbookLineAt: number;
  /**
   * Announces a logbook line (badge earned, milestone). Decided after the
   * current frame's broadcasts are out, so a payoff sent in the same frame,
   * before or after, is read first: a fresh broadcast holds the line 4.5 s,
   * and logbook lines queue 4.5 s apart.
   */
  announceLogbook: (line: string) => void;
}

/**
 * A badge earned in the same moment as its payoff (a scan report, a lap time)
 * must not cut that line off: RadioChatter's single typewriter line cancels
 * whatever it is typing. Same delay as the shard-completion fanfare.
 */
const BADGE_LINE_HOLD_MS = 3000;
const BADGE_LINE_DELAY_MS = 4500;

// Initial state, read once at import. The stored plume is checked against the
// stored progress of three slices (dossiers, shards, charting) as well as the badges.
const initialBadges = loadBadges(safeGetJSON<unknown>(STORE_KEYS.logbook, []));
const initialPlume = (() => {
  const raw = safeGetJSON<unknown>(STORE_KEYS.plume, "stock");
  const progress = { visitedDossiers: loadVisitedDossiers(), shardsCollected: loadShards(safeGetJSON<unknown>(STORE_KEYS.shards, [])), badges: initialBadges };
  return typeof raw === "string" && plumeAllowed(raw, progress, hasPlumeColour, initialCharted, initialLegacyCartographer) ? raw : "stock";
})();

/**
 * Cross-slice: announceLogbook reads the HUD slice's broadcast and sends through
 * its sendBroadcast; setPlumeColor reads the dossier and progress slices.
 */
export const createLogbookSlice: SliceCreator<LogbookSlice> = (set, get) => ({
  badges: initialBadges,
  recordBadge: (id) => {
    if (!isRecordable(id) || get().badges.some((b) => b.id === id)) return;
    const next = [...get().badges, { id, at: todayStamp() }];
    safeSetJSON(STORE_KEYS.logbook, next);
    set({ badges: next });
    const entry = LOGBOOK.find((e) => e.id === id);
    get().announceLogbook(badgeLine(id, entry?.plume ? PLUME_COLORS[id]?.name ?? null : null));
  },
  plumeColor: initialPlume,
  setPlumeColor: (id) => {
    const s = get();
    const progress = { visitedDossiers: s.visitedDossiers, shardsCollected: s.shardsCollected, badges: s.badges };
    if (!plumeAllowed(id, progress, hasPlumeColour, s.charted, s.legacyCartographer) || s.plumeColor === id) return;
    safeSetJSON(STORE_KEYS.plume, id);
    set({ plumeColor: id });
  },
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
});
