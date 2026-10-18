import { WORLDS, WORLD_COUNT, isWorld, type WorldId } from "../data/worlds";
import { WORLD_FACTS } from "./worldReports";

/**
 * Charting the worlds (spec "Charting, logbook and title"): the first scan of
 * a world charts it. Pure. Records persist in their own key, fitz-charted,
 * never fitz-logbook: an older bundle would drop unknown ids and overwrite it.
 */
export interface ChartRecord { id: WorldId; at: string /* YYYY-MM-DD */ }

const DATE_STAMP = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A YYYY-MM-DD stamp naming a real calendar day (not 2026-13-40). */
function isDateStamp(s: string): boolean {
  const m = DATE_STAMP.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * Stored charting, sanitised like loadBadges: world ids and real dates only,
 * one record per world (its earliest date). Hand-edited or corrupt storage
 * must not crash the store or grant anything.
 */
export function loadCharted(raw: unknown): ChartRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id, at } = r as { id?: unknown; at?: unknown };
    if (typeof id !== "string" || typeof at !== "string" || !isWorld(id) || !isDateStamp(at)) continue;
    const seen = out.find((c) => c.id === id);
    // Same-shape stamps compare as dates.
    if (seen) { if (at < seen.at) seen.at = at; continue; }
    out.push({ id, at });
  }
  return out;
}

/** The title is derived, never stored: every world charted. */
export function isCartographer(c: readonly ChartRecord[]): boolean {
  return new Set(c.filter((r) => isWorld(r.id)).map((r) => r.id)).size === WORLD_COUNT;
}

/** The radio line for the `count`th world charted: its namesake type and one fact. */
export function chartLine(id: WorldId, count: number): string {
  const w = WORLDS.find((x) => x.id === id)!;
  return `WORLD CHARTED ${count}/${WORLD_COUNT} — ${w.namesake.toUpperCase()}-TYPE: ${WORLD_FACTS[id][0]}`;
}

/** The rarer line, once, when the last world is charted. */
export const SURVEY_LINE = "SYSTEM SURVEY COMPLETE — EVERY WORLD CHARTED. YOU HOLD THE TITLE CARTOGRAPHER.";
