import { BEACON_PHRASES } from "../data/beaconPhrases";
import { SYSTEM_RADIUS, VALIDATION_RADIUS } from "../constants";
import { SPAWN } from "../data/spawn";
import { BOTTLE_MAX_CHARS } from "./bottleFilter";

export interface BeaconDrop { x: number; y: number; z: number; phrase: number }

/** Live bottles by scannable id ("beacon_<id>"), for scan reports. Written by Beacons.tsx. */
export const beaconRegistry = new Map<string, Bottle>();

/**
 * No beacons within this distance of the spawn pad (src/data/spawn.ts): every visitor
 * starts there, so a pile of them would be the first thing a recruiter sees.
 */
export const SPAWN_KEEP_OUT = 15;


/**
 * A message in a bottle as the API serves it (GET /beacons). `text` passed
 * src/utils/bottleFilter.ts on the Worker; render it as plain text only.
 */
export interface Bottle {
  id: string;
  x: number; y: number; z: number;
  text: string;
  /** Drop time, epoch ms. */
  at: number;
  /** ISO 3166 alpha-2 from Cloudflare's edge, or null when unknown. */
  country: string | null;
}

/**
 * The scene's name for a bottle until Beacons.tsx becomes Bottles.tsx (plan
 * task 5). The old phrase-index Beacon is gone: the API serves text.
 */
export type Beacon = Bottle;

/** Most bottles the API serves (newest first), and the most the scene shows besides the visitor's own. */
export const BOTTLE_LIMIT = 30;
/**
 * The visitor's own bottles kept in this browser (fitz-own-bottles), so they
 * show even once they fall outside the newest BOTTLE_LIMIT. The daily cap is
 * 5, so 10 is two days' worth at the most.
 */
export const OWN_BOTTLES_KEPT = 10;
/** The most bottles ever shown at once: the newest BOTTLE_LIMIT plus the visitor's own. */
export const BOTTLES_SHOWN_MAX = BOTTLE_LIMIT + OWN_BOTTLES_KEPT;
/** Instance capacity of Beacons.tsx (until task 5 replaces it): every bottle that can be shown. */
export const BEACON_LIMIT = BOTTLES_SHOWN_MAX;
/** Bottles one pilot may leave in any 24 hours. */
export const BOTTLE_DAILY_CAP = 5;
/**
 * Why a drop was refused with 429 (body `{ error: "rate", reason, retryAfter }`,
 * retryAfter in seconds): `wait` is the per-pilot 10-minute window, `daily`
 * the BOTTLE_DAILY_CAP, `busy` the cap across all pilots.
 */
export type BottleRateReason = "wait" | "daily" | "busy";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCoord = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inBounds = (x: number, y: number, z: number) => Math.hypot(x, y, z) <= VALIDATION_RADIUS;

/** Beacons drawn and scannable: inside the playable system (the return burn starts at its edge). */
export function beaconVisible(p: { x: number; y: number; z: number }): boolean {
  return Math.hypot(p.x, p.y, p.z) <= SYSTEM_RADIUS;
}
const isPhrase = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < BEACON_PHRASES.length;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Validates where a drop lands: inside the system and away from the spawn
 * pad, rounded to 0.1. Shared by the client (before sending) and the Worker
 * (on receipt), so the two can never disagree about what is allowed.
 */
export function validatePosition(body: unknown): { ok: true; pos: { x: number; y: number; z: number } } | { ok: false } {
  if (!isObj(body)) return { ok: false };
  const { x, y, z } = body;
  if (!isCoord(x) || !isCoord(y) || !isCoord(z) || !inBounds(x, y, z)) return { ok: false };
  if (Math.hypot(x - SPAWN.x, y - SPAWN.y, z - SPAWN.z) < SPAWN_KEEP_OUT) return { ok: false };
  return { ok: true, pos: { x: round1(x), y: round1(y), z: round1(z) } };
}

/** Validates a legacy phrase drop: a position (validatePosition) and a BEACON_PHRASES index. */
export function validateDrop(body: unknown): { ok: true; drop: BeaconDrop } | { ok: false } {
  const p = validatePosition(body);
  if (!p.ok || !isPhrase((body as Record<string, unknown>).phrase)) return { ok: false };
  return { ok: true, drop: { ...p.pos, phrase: (body as { phrase: number }).phrase } };
}

const ID_RE = /^[a-zA-Z0-9-]{1,64}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

/**
 * Parses an API response (GET /beacons, or `{ beacons: [body.beacon] }` for a
 * POST), which is untrusted: malformed rows are dropped rather than rendered
 * or thrown, and the list is capped at `limit` so a hostile or broken server
 * cannot flood the scene. A legacy row's extra `phrase` key is ignored; a row
 * with no text (the old API) is not a bottle. The text is kept as served and
 * only ever rendered as plain text.
 */
export function parseBottles(body: unknown, limit: number = BOTTLE_LIMIT): Bottle[] {
  if (!isObj(body) || !Array.isArray(body.beacons)) return [];
  const out: Bottle[] = [];
  for (const r of body.beacons) {
    if (out.length >= limit) break;
    const b = parseBottle(r);
    if (b) out.push(b);
  }
  return out;
}

/** One untrusted row (from the API or from storage) as a Bottle, or null. */
export function parseBottle(r: unknown): Bottle | null {
  if (!isObj(r)) return null;
  const { id, x, y, z, text, at, country } = r;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  if (!isCoord(x) || !isCoord(y) || !isCoord(z) || !inBounds(x, y, z)) return null;
  if (typeof text !== "string" || text.length > BOTTLE_MAX_CHARS * 2 || !text.trim()) return null;
  if (Array.from(text).length > BOTTLE_MAX_CHARS) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (country !== null && (typeof country !== "string" || !COUNTRY_RE.test(country))) return null;
  return { id, x, y, z, text, at, country };
}

/**
 * What the sky shows (spec "Seeing and reading bottles"): the newest
 * BOTTLE_LIMIT of everything known, plus the visitor's own bottles even when
 * they fall outside it. Newest first, each id once. `own` is capped at
 * OWN_BOTTLES_KEPT by the store, so the result never exceeds BOTTLES_SHOWN_MAX.
 */
export function mergeBottles(served: readonly Bottle[], own: readonly Bottle[]): Bottle[] {
  const byId = new Map<string, Bottle>();
  for (const b of [...own.slice(0, OWN_BOTTLES_KEPT), ...served]) if (!byId.has(b.id)) byId.set(b.id, b);
  const all = [...byId.values()].sort((a, b) => b.at - a.at);
  const ownIds = new Set(own.slice(0, OWN_BOTTLES_KEPT).map((b) => b.id));
  const head = all.slice(0, BOTTLE_LIMIT);
  return [...head, ...all.slice(BOTTLE_LIMIT).filter((b) => ownIds.has(b.id))];
}

function age(ms: number): string {
  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "S"} AGO`;
  if (ms < 60_000) return "JUST NOW";
  if (ms < 3_600_000) return unit(Math.floor(ms / 60_000), "MINUTE");
  if (ms < 86_400_000) return unit(Math.floor(ms / 3_600_000), "HOUR");
  return unit(Math.floor(ms / 86_400_000), "DAY");
}

/** The scan readout for a bottle: plain text, never markup. */
export function beaconReport(b: Bottle, now: number): string {
  const from = b.country ? ` · PILOT FROM ${b.country}` : "";
  return `BOTTLE // "${b.text}"${from} · ${age(Math.max(0, now - b.at))}`;
}
