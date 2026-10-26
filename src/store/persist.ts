import { REDUCED_MOTION_KEY } from "../utils/reducedMotionPreference";
import { isRecordable, type BadgeRecord } from "../utils/logbook";
import { LEGACY_CARTOGRAPHER_KEY } from "../utils/charting";
import { SHARDS } from "../data/shards";

/**
 * The store's localStorage helpers and loaders (spaceStore.ts re-exports the
 * ones tests import). Every helper is guarded: localStorage can be absent, or
 * throw (e.g. SecurityError when cookies/storage are blocked), and a blocked
 * store degrades to in-memory rather than crashing.
 */

/** Every key the store persists. Their names and formats are pinned by tests: never rename one. */
export const STORE_KEYS = {
  muted: "fitz-sound-muted",
  reducedMotion: REDUCED_MOTION_KEY,
  dossiers: "fitz-dossiers",
  probes: "fitz-probes",
  logbook: "fitz-logbook",
  plume: "fitz-plume",
  shards: "fitz-shards",
  charted: "fitz-charted",
  chartShout: "fitz-charted-shout",
  aurumTold: "fitz-aurum-told",
  raceBest: "fitz-race-best",
  /** The current race's token and stamps (raceSession.ts RaceRun), so a reload mid-race keeps them. */
  raceRun: "fitz-race-run",
  ownBeacons: "fitz-own-beacons",
  ownBottles: "fitz-own-bottles",
  showBottles: "fitz-bottles",
  liveSky: "fitz-live-sky",
  liveSkySeen: "fitz-live-seen-2",
  changelogSeen: "fitz-changelog-seen",
  legacyCartographer: LEGACY_CARTOGRAPHER_KEY,
} as const;

export function safeGetMuted(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORE_KEYS.muted) === "1";
  } catch {
    return false;
  }
}
export function safeSetMuted(v: boolean) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORE_KEYS.muted, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
/** A persisted on/off setting ("1"/"0"), guarded like the mute flag. */
export function safeGetFlag(key: string, fallback: boolean): boolean {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
export function safeSetFlag(key: string, v: boolean) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// Three states — "1", "0", or absent — because absent (no choice made) must
// stay distinguishable from an explicit false, which has to beat a media
// query that says true.
export function safeGetReducedMotion(): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORE_KEYS.reducedMotion);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}
export function safeSetReducedMotion(v: boolean) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORE_KEYS.reducedMotion, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** A stored string as is, or null when absent or storage is blocked. */
export function safeGetString(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}
/** Removes a stored key; only touches storage when the key is there. */
export function safeRemove(key: string) {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(key) !== null) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function safeGetJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
export function safeSetJSON(key: string, value: unknown) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/**
 * Read dossiers from storage, keeping only current project ids: ids from an
 * older content set (e.g. "saas") must not count toward n/3, and a value that
 * isn't an array (hand-edited storage) must not crash the store at import.
 */
export function loadVisitedDossiers(projectIds: readonly string[]): string[] {
  const raw = safeGetJSON<unknown>(STORE_KEYS.dossiers, []);
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && projectIds.includes(id)) : [];
}

const DATE_STAMP = /^\d{4}-\d{2}-\d{2}$/;

/** Local date as YYYY-MM-DD, for the "earned" stamp. */
export function todayStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Stored badges, sanitised: known recordable ids only, a YYYY-MM-DD date (the
 * `todayStamp` shape), first occurrence wins. Hand-edited or stale storage must not crash the store or
 * grant anything.
 */
export function loadBadges(raw: unknown): BadgeRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: BadgeRecord[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { id, at } = r as { id?: unknown; at?: unknown };
    if (typeof id !== "string" || typeof at !== "string" || !isRecordable(id) || !DATE_STAMP.test(at)) continue;
    if (out.some((b) => b.id === id)) continue;
    out.push({ id, at });
  }
  return out;
}

/**
 * Stored shard pickups, sanitised: unique integer indices of real shards. A
 * hand-edited or corrupt value (null, a string) must not crash the store at
 * import or grant the Shard hunter badge.
 */
export function loadShards(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    if (Number.isInteger(v) && v >= 0 && v < SHARDS.length && !out.includes(v)) out.push(v);
  }
  return out;
}
