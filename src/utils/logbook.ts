import { COSMIC_BOUNDS } from "../constants";
import { toroidalDistance3 } from "./toroidal";
import type { Vec3 } from "./reactions";

/**
 * The pilot logbook (docs/superpowers/specs/2026-10-13-pilot-logbook-design.md):
 * four essentials that tour the portfolio, then six flight badges that each
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
const DOSSIERS: readonly string[] = ["ruangrapi", "portfolio", "fuxx"];

export const LOGBOOK: readonly LogbookEntry[] = [
  { id: "ruangrapi", section: "essential", title: "Read the RuangRapi dossier", hint: "READ THE RUANGRAPI DOSSIER", hintShort: "RUANGRAPI DOSSIER", plume: false },
  { id: "portfolio", section: "essential", title: "Read the Flight-Sim CV dossier", hint: "READ THE FLIGHT-SIM CV DOSSIER", hintShort: "CV DOSSIER", plume: false },
  { id: "fuxx", section: "essential", title: "Read the fuxx dossier", hint: "READ THE FUXX DOSSIER", hintShort: "FUXX DOSSIER", plume: false },
  { id: "contact", section: "essential", title: "Reach the contact portal", hint: "DOCK AT THE CONTACT PORTAL", hintShort: "CONTACT PORTAL", plume: false },
  { id: "slingshot", section: "badge", title: "Slingshot", hint: "SKIM A PLANET FAST FOR A GRAVITY ASSIST", hintShort: "SLINGSHOT A PLANET", plume: true },
  { id: "comet", section: "badge", title: "Comet chaser", hint: "SCAN A VISITING COMET (HOLD E)", hintShort: "SCAN A COMET", plume: true },
  { id: "ring", section: "badge", title: "Ring runner", hint: "LAP THE RING COURSE UNDER 1:00", hintShort: "RING LAP < 1:00", plume: true },
  { id: "ore", section: "badge", title: "Prospector", hint: "MINE A CRYSTAL'S WORTH OF ORE (HOLD F)", hintShort: "MINE 16 ORE", plume: true },
  { id: "convoy", section: "badge", title: "Convoy spotter", hint: "WATCH A CONVOY DELIVER UP CLOSE", hintShort: "SPOT A CONVOY", plume: true },
  { id: "shards", section: "badge", title: "Shard hunter", hint: `FIND ${SHARDS_FOR_BADGE} DATA SHARDS`, hintShort: `FIND ${SHARDS_FOR_BADGE} SHARDS`, plume: true },
];

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
  const e = LOGBOOK.find((x) => x.id === id);
  const title = (e?.title ?? id).toUpperCase();
  return plumeName
    ? `LOGBOOK // ${title} EARNED — ${plumeName} PLUME UNLOCKED. PRESS L`
    : `LOGBOOK // ${title} EARNED. PRESS L`;
}

/** True when any convoy ship is within `radius` of the ship (wrap-aware). */
export function convoySighted(ship: Vec3, ships: readonly Vec3[], radius = CONVOY_SIGHT_RADIUS): boolean {
  for (const s of ships) {
    if (toroidalDistance3(ship.x, ship.z, ship.y, s.x, s.z, s.y, COSMIC_BOUNDS) < radius) return true;
  }
  return false;
}

/**
 * Whether plume `id` may be selected: "stock" always; otherwise a badge entry
 * with a colour whose entry is done (derived badges count too).
 */
export function plumeAllowed(id: string, p: LogbookProgress, hasColour: (id: string) => boolean): boolean {
  if (id === "stock") return true;
  const e = LOGBOOK.find((x) => x.id === id);
  return !!e && e.section === "badge" && e.plume && hasColour(id) && entryDone(e, p);
}
