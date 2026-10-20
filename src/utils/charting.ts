import { isBodyId, LEGACY_WORLD_TO_BODY, type BodyId } from "../data/bodyIds";
import { BODY_COUNT, bodyById } from "../data/solarSystem";
import { BODY_FACTS } from "./worldReports";

/**
 * Charting the bodies (spec "Charting, logbook and title"; real-solar-system
 * spec §7): the first scan of a body charts it. Pure. Records persist in their
 * own key, fitz-charted, never fitz-logbook: an older bundle would drop
 * unknown ids and overwrite it.
 */
export interface ChartRecord { id: BodyId; at: string /* YYYY-MM-DD */ }

/**
 * A stored id in today's terms: a body id as it is, one of the five old
 * fictional worlds' ids as the real body it became (w-rock → mercury …), and
 * anything else null. No stored progress is lost (§7).
 */
function currentBodyId(id: string): BodyId | null {
  if (isBodyId(id)) return id;
  return Object.hasOwn(LEGACY_WORLD_TO_BODY, id) ? LEGACY_WORLD_TO_BODY[id as keyof typeof LEGACY_WORLD_TO_BODY] : null;
}

const DATE_STAMP = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A YYYY-MM-DD stamp naming a real calendar day (not 2026-13-40). */
function isDateStamp(s: string): boolean {
  const m = DATE_STAMP.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * Stored charting, sanitised like loadBadges: body ids (legacy world ids
 * mapped through LEGACY_WORLD_TO_BODY first) and real dates only, one record
 * per body (its earliest date). Hand-edited or corrupt storage must not crash
 * the store or grant anything. The store rewrites fitz-charted in the new ids
 * on its next charting write.
 */
export function loadCharted(raw: unknown): ChartRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id: storedId, at } = r as { id?: unknown; at?: unknown };
    const id = typeof storedId === "string" ? currentBodyId(storedId) : null;
    if (id === null || typeof at !== "string" || !isDateStamp(at)) continue;
    const seen = out.find((c) => c.id === id);
    // Same-shape stamps compare as dates.
    if (seen) { if (at < seen.at) seen.at = at; continue; }
    out.push({ id, at });
  }
  return out;
}

/** The title is derived, never stored: every body charted. */
export function isCartographer(c: readonly ChartRecord[]): boolean {
  return new Set(c.filter((r) => isBodyId(r.id)).map((r) => r.id)).size === BODY_COUNT;
}

/** The radio line for the `count`th body charted: its name and one fact. */
export function chartLine(id: BodyId, count: number): string {
  return `WORLD CHARTED ${count}/${BODY_COUNT} — ${bodyById(id).name}: ${BODY_FACTS[id][0]}`;
}

/** The rarer line, once, when the last world is charted. */
export const SURVEY_LINE = "SYSTEM SURVEY COMPLETE — EVERY WORLD CHARTED. YOU HOLD THE TITLE CARTOGRAPHER.";
/** Follows the survey line: the title's reward and where to fit it. */
export const AURUM_LINE = "AURUM PLUME UNLOCKED // FIT IT IN THE SHIPYARD HANGAR";

/** How long a shout-out waits for company after the last body: a day, then it is dropped. */
export const SHOUT_PENDING_MS = 24 * 60 * 60 * 1000;

/** Whether the "new cartographer" shout-out armed at `pendingAt` may still go out. */
export function shoutDue(pendingAt: number | null, now: number): boolean {
  return pendingAt !== null && now - pendingAt < SHOUT_PENDING_MS;
}

/** The radio line for another pilot's shout-out: a fixed template, no free text. */
export const shoutLine = (cc: string | null): string =>
  `A PILOT ${cc ? `FROM ${cc} ` : ""}HAS CHARTED EVERY WORLD. A NEW CARTOGRAPHER FLIES.`;

/**
 * Shortest gap between two shout-outs this page plays. The room's own limits
 * live in memory and a hibernated room forgets them, so the listener holds
 * its own line too: a replayed claim can't flood anyone's radio.
 */
export const SHOUT_HEAR_GAP_MS = 5 * 60_000;

/** A gate for incoming shout-outs: true when one may play at `now` (and records it). */
export function createShoutGate(gapMs = SHOUT_HEAR_GAP_MS): (now: number) => boolean {
  let last = -Infinity;
  return (now) => {
    if (now - last < gapMs) return false;
    last = now;
    return true;
  };
}
