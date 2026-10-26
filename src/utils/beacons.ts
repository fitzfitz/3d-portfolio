import { BEACON_PHRASES } from "../data/beaconPhrases";
import { SYSTEM_RADIUS, VALIDATION_RADIUS } from "../constants";
import { SPAWN } from "../data/spawn";

/** A visitor's beacon as the API serves it. */
export interface Beacon {
  id: string;
  x: number; y: number; z: number;
  /** Index into BEACON_PHRASES. */
  phrase: number;
  /** Drop time, epoch ms. */
  at: number;
  /** ISO 3166 alpha-2 from Cloudflare's edge, or null when unknown. */
  country: string | null;
}

export interface BeaconDrop { x: number; y: number; z: number; phrase: number }

/** Live beacons by scannable id ("beacon_<id>"), for scan reports. Written by Beacons.tsx. */
export const beaconRegistry = new Map<string, Beacon>();

/**
 * No beacons within this distance of the spawn pad (src/data/spawn.ts): every visitor
 * starts there, so a pile of them would be the first thing a recruiter sees.
 */
export const SPAWN_KEEP_OUT = 15;

/** Most beacons the scene renders, and the most the API serves. */
export const BEACON_LIMIT = 40;

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

/** Most bottles the API serves (newest first), and the most the scene shows besides the visitor's own. */
export const BOTTLE_LIMIT = 30;
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
 * Parses an API response, which is untrusted: malformed rows are dropped
 * rather than rendered or thrown, and the list is capped at BEACON_LIMIT so a
 * hostile or broken server cannot flood the scene.
 */
export function parseBeacons(body: unknown): Beacon[] {
  if (!isObj(body) || !Array.isArray(body.beacons)) return [];
  const out: Beacon[] = [];
  for (const r of body.beacons) {
    if (out.length >= BEACON_LIMIT) break;
    if (!isObj(r)) continue;
    const { id, x, y, z, phrase, at, country } = r;
    if (typeof id !== "string" || !ID_RE.test(id)) continue;
    if (!isCoord(x) || !isCoord(y) || !isCoord(z) || !inBounds(x, y, z) || !isPhrase(phrase)) continue;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (country !== null && (typeof country !== "string" || !COUNTRY_RE.test(country))) continue;
    out.push({ id, x, y, z, phrase, at, country });
  }
  return out;
}

function age(ms: number): string {
  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "S"} AGO`;
  if (ms < 60_000) return "JUST NOW";
  if (ms < 3_600_000) return unit(Math.floor(ms / 60_000), "MINUTE");
  if (ms < 86_400_000) return unit(Math.floor(ms / 3_600_000), "HOUR");
  return unit(Math.floor(ms / 86_400_000), "DAY");
}

/** The scan readout for a beacon. */
export function beaconReport(b: Beacon, now: number): string {
  const from = b.country ? ` · PILOT FROM ${b.country}` : "";
  return `BEACON // "${BEACON_PHRASES[b.phrase]}"${from} · ${age(Math.max(0, now - b.at))}`;
}
