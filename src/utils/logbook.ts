import type { Vec3 } from "./reactions";
import { PROBE_IDS } from "../data/probes";
import { jumpKey } from "../data/destinations";
import { projectById } from "../constants";
import { isCartographer, type ChartRecord } from "./charting";

/**
 * The pilot logbook (docs/archive/specs/2026-10-13-pilot-logbook-design.md):
 * essentials that tour the portfolio (a dossier per probe in play, then the
 * career station and the contact portal), then six flight badges that each
 * unlock a plume colour. Pure. Dossier and shard entries are derived from
 * state the store already persists; the rest are recorded badges.
 */
export type LogbookSection = "essential" | "badge";
export interface LogbookEntry { id: string; section: LogbookSection; title: string; hint: string; hintShort: string; plume: boolean }
export interface BadgeRecord { id: string; at: string }
export interface LogbookProgress {
  visitedDossiers: readonly string[];
  shardsCollected: readonly number[];
  badges: readonly BadgeRecord[];
}

export const SHARDS_FOR_BADGE = 3;
export const CONVOY_SIGHT_RADIUS = 120;

/** Entry ids derived from other state, never recorded. */
const DOSSIERS: readonly string[] = PROBE_IDS;

/** True for the project-dossier entries (re-openable from the logbook once read). */
export const isDossierEntry = (id: string): boolean => DOSSIERS.includes(id);

/** The longest a short hint may be: the phone tracker's one line (tests/logbook.test.ts). */
const HINT_SHORT_MAX = 18;

/**
 * A probe's dossier essential, worded from its project's title (spec
 * 2026-10-23-dynamic-content, build ruling R9): a leading "This" or "The" is
 * dropped, and the short hint is the longest tail of the title's words that
 * fits HINT_SHORT_MAX with " PROBE", else "PROBE <n>". The bundled three come
 * out word for word as they were written by hand. `i` is the probe's index.
 */
export function dossierEntry(p: { id: string; title: string }, i: number): LogbookEntry {
  const name = p.title.trim().replace(/^(this|the)\s+/i, "");
  const words = name.toUpperCase().split(/\s+/);
  let hintShort = `PROBE ${i + 1}`;
  for (let k = 0; k < words.length; k++) {
    const tail = `${words.slice(k).join(" ")} PROBE`;
    if (tail.length <= HINT_SHORT_MAX) { hintShort = tail; break; }
  }
  return {
    id: p.id, section: "essential", title: `Read the ${name} dossier`,
    hint: `GRAB THE ${name.toUpperCase()} PROBE (HOLD F)`, hintShort, plume: false,
  };
}

/** The entries after the dossiers: the two destination essentials, then the badges. */
const FIXED_ENTRIES: readonly LogbookEntry[] = [
  { id: "career", section: "essential", title: "Read the career dossier", hint: "DOCK AT THE CAREER STATION", hintShort: "CAREER DOSSIER", plume: false },
  { id: "contact", section: "essential", title: "Reach the contact portal", hint: "DOCK AT THE CONTACT PORTAL", hintShort: "CONTACT PORTAL", plume: false },
  { id: "slingshot", section: "badge", title: "Slingshot", hint: "SKIM A PLANET OR THE SUN, LEAVE FAST", hintShort: "GRAVITY SLINGSHOT", plume: true },
  { id: "comet", section: "badge", title: "Comet chaser", hint: "SCAN A VISITING COMET (HOLD E)", hintShort: "SCAN A COMET", plume: true },
  { id: "ring", section: "badge", title: "Ring runner", hint: "LAP THE RING COURSE UNDER 1:00", hintShort: "RING LAP < 1:00", plume: true },
  { id: "ore", section: "badge", title: "Prospector", hint: "MINE A CRYSTAL'S WORTH OF ORE (HOLD F)", hintShort: "MINE 16 ORE", plume: true },
  { id: "convoy", section: "badge", title: "Convoy spotter", hint: "WATCH A CONVOY DELIVER UP CLOSE", hintShort: "SPOT A CONVOY", plume: true },
  { id: "shards", section: "badge", title: "Shard hunter", hint: `FIND ${SHARDS_FOR_BADGE} DATA SHARDS`, hintShort: `FIND ${SHARDS_FOR_BADGE} SHARDS`, plume: true },
];

/** The logbook for these probes, in play order: a dossier each, then career, contact and the badges. */
export function buildLogbook(probes: readonly { id: string; title: string }[]): LogbookEntry[] {
  return [...probes.map(dossierEntry), ...FIXED_ENTRIES];
}

/** This visit's logbook: one dossier essential per probe in play. */
export const LOGBOOK: readonly LogbookEntry[] = buildLogbook(PROBE_IDS.map((id) => ({ id, title: projectById(id)?.title ?? id })));

export function entryDone(e: LogbookEntry, p: LogbookProgress): boolean {
  if (DOSSIERS.includes(e.id)) return p.visitedDossiers.includes(e.id);
  if (e.id === "shards") return p.shardsCollected.length >= SHARDS_FOR_BADGE;
  return p.badges.some((b) => b.id === e.id);
}

export function logbookCount(p: LogbookProgress): { done: number; total: number } {
  let done = 0;
  for (const e of LOGBOOK) if (entryDone(e, p)) done++;
  return { done, total: LOGBOOK.length };
}

/** First unfinished entry in table order (essentials come first), or null. */
export function nextGoal(p: LogbookProgress): LogbookEntry | null {
  return LOGBOOK.find((e) => !entryDone(e, p)) ?? null;
}

export function essentialsDone(p: LogbookProgress): boolean {
  return LOGBOOK.every((e) => e.section !== "essential" || entryDone(e, p));
}

export function allDone(p: LogbookProgress): boolean {
  return LOGBOOK.every((e) => entryDone(e, p));
}

/** The ids recordBadge accepts: every entry not derived from other state. */
export function isRecordable(id: string): boolean {
  return LOGBOOK.some((e) => e.id === id) && !DOSSIERS.includes(id) && id !== "shards";
}

/** The announced radio line for a newly earned entry. */
export function badgeLine(id: string, plumeName: string | null): string {
  if (id === "contact") return "LOGBOOK // CONTACT PORTAL REACHED";
  if (id === "career") return "LOGBOOK // CAREER DOSSIER READ";
  const e = LOGBOOK.find((x) => x.id === id);
  const title = (e?.title ?? id).toUpperCase();
  return plumeName
    ? `LOGBOOK // ${title} EARNED — ${plumeName} PLUME UNLOCKED. DOCK AT THE SHIPYARD [${jumpKey("shipyard")}]`
    : `LOGBOOK // ${title} EARNED. PRESS L`;
}

/** True when any convoy ship is within `radius` of the ship. */
export function convoySighted(ship: Vec3, ships: readonly Vec3[], radius = CONVOY_SIGHT_RADIUS): boolean {
  for (const s of ships) {
    if (Math.hypot(ship.x - s.x, ship.z - s.z, ship.y - s.y) < radius) return true;
  }
  return false;
}

/**
 * Whether plume `id` may be selected: "stock" always; "cartographer" (AURUM)
 * once every body is charted (charting.ts isCartographer); otherwise a badge entry with a colour
 * whose entry is done (derived badges count too).
 */
export function plumeAllowed(
  id: string, p: LogbookProgress, hasColour: (id: string) => boolean, charted: readonly ChartRecord[] = [], legacyCartographer = false,
): boolean {
  if (id === "stock") return true;
  if (id === "cartographer") return hasColour(id) && isCartographer(charted, legacyCartographer);
  const e = LOGBOOK.find((x) => x.id === id);
  return !!e && e.section === "badge" && e.plume && hasColour(id) && entryDone(e, p);
}

/**
 * The everything-done milestone line. It claims only the badge plumes, so it
 * stays true once a plume is earned by charting the worlds, outside the 11.
 */
export const ALL_LINE = "LOGBOOK COMPLETE // ALL BADGE PLUMES UNLOCKED. FLY PRETTY, PILOT";

/** The milestone a progress change crosses (everything-done wins); null if none was newly crossed. */
export function milestoneFor(prev: LogbookProgress, next: LogbookProgress): "essentials" | "all" | null {
  if (allDone(next) && !allDone(prev)) return "all";
  if (essentialsDone(next) && !essentialsDone(prev)) return "essentials";
  return null;
}
