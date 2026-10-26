import { SHIP_WARP_SPEED } from "../constants";
import { RING_RADIUS } from "../data/ringCourse";
import { MAX_MESSAGE_BYTES } from "./liveSkyProtocol";
import { GHOST_HZ, sampleGhost, type Ghost } from "./race";

/**
 * Ring race wire protocol and rules (docs/archive/specs/2026-10-26-ring-race-design.md).
 * Binding-free and shared by the client and beacon-api's Sky room, as
 * liveSkyProtocol.ts is: both validate the same way. Race messages ride the
 * live-sky socket under their own `r…` types, so the two parsers never both match.
 */

export const RACE_MIN_PILOTS = 2;
export const RACE_MAX_PILOTS = 8;
/** Countdown once a second pilot joins. */
export const LOBBY_COUNTDOWN_MS = 15_000;
/** Alone this long, a pilot races the best lap. */
export const ALONE_MS = 30_000;
export const FINAL_CALL_MS = 30_000;
export const RACE_LIMIT_MS = 180_000;
export const UPLOAD_WINDOW_MS = 30_000;
export const AGAIN_WINDOW_MS = 20_000;
export const INVITE_TTL_MS = 900_000;
/** How close a pilot must be to join a public race at a beacon. */
export const JOIN_RADIUS = 15;
export const RACE_SPEED = SHIP_WARP_SPEED;
/** The "someone is waiting" radio line, at most this often. */
export const WAIT_SHOUT_MS = 60_000;
/** The 3-2-1 before GO. */
export const GRID_MS = 3_000;
/** Beyond RING_RADIUS, for a pose up to ~0.45 s old at warp. */
export const STAMP_POS_MARGIN = 30;
export const POSE_FRESH_MS = 1_500;
export const SPEED_SLACK_S = 0.5;
/** HMAC-SHA256 truncated to 128 bits, as hex characters. */
export const SIG_HEX = 32;
export const MIN_RACE_SECRET = 32;
export const UPLOAD_MAX_BYTES = 65_536;
export const RACE_COURSE_ID = "loop-2";

export type RaceKind = "public" | "private" | "solo";
export type RaceError = "full" | "expired" | "busy" | "off" | "ring";
/** r race id, k token, i ring (0 = start/GO, 1..N-1 rings, N = finish), at server ms. */
export interface Stamp { r: string; k: string; i: number; at: number; sig: string }
export interface LobbyPilot { cc: string | null; you: boolean }
export interface ResultEntry { token: string; cc: string | null; timeMs: number | null; rings: number; lastAt: number }
export interface ResultRow { place: number; cc: string | null; timeMs: number | null; rings: number; you: boolean }
export type RaceClientMessage =
  | { t: "rjoin"; code?: string; token?: string } | { t: "rinvite" } | { t: "rstart" } | { t: "rsolo" }
  | { t: "rleave" } | { t: "rring"; i: number } | { t: "ragain" };
export type RaceServerMessage =
  | { t: "rlobby"; race: string; kind: RaceKind; code: string | null; host: boolean; token: string; pilots: LobbyPilot[]; startsAt: number | null; now: number }
  | { t: "rgrid"; race: string; kind: RaceKind; slot: number; goAt: number; now: number }
  | { t: "rgo"; stamp: Stamp; now: number }
  | { t: "rstamp"; stamp: Stamp }
  | { t: "rfinal"; endsAt: number; now: number }
  | { t: "rover"; race: string; uploadBy: number; now: number }
  | { t: "rresults"; race: string; rows: ResultRow[]; againBy: number; now: number }
  | { t: "rwait"; cc: string | null }
  | { t: "rerr"; reason: RaceError };
export type LapCheck = { ok: true; rings: number; timeMs: number | null; lastAt: number }
  | { ok: false; reason: "sig" | "race" | "order" | "speed" | "start" };

type Centres = readonly (readonly [number, number, number])[];

// ---- codes and tokens ------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const SIG_RE = new RegExp(`^[0-9a-f]{${SIG_HEX}}$`);
/** Race ids: no `|`, so a stamp payload splits one way only. */
export const RACE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export const isInviteCode = (s: unknown): s is string => typeof s === "string" && CODE_RE.test(s);

/** Six characters without the look-alikes (0 O 1 I L). Rejection sampling keeps every character equally likely. */
export function newInviteCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = "";
  while (out.length < CODE_LEN) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < CODE_LEN) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

export function newRaceToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- parsing ---------------------------------------------------------------

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const str = (v: unknown, max = 64): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const ccOrNull = (v: unknown): v is string | null => v === null || (typeof v === "string" && /^[A-Z]{2}$/.test(v));
const KINDS = ["public", "private", "solo"];
const ERRORS = ["full", "expired", "busy", "off", "ring"];

function parseObject(raw: unknown, maxBytes?: number): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  if (maxBytes !== undefined) {
    if (raw.length > maxBytes || new TextEncoder().encode(raw).length > maxBytes) return null;
  }
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
}

/** A client's race message, or null for anything else (live-sky messages included). */
export function parseRaceClient(raw: unknown): RaceClientMessage | null {
  const o = parseObject(raw, MAX_MESSAGE_BYTES);
  if (!o) return null;
  switch (o.t) {
    case "rjoin": {
      const m: { t: "rjoin"; code?: string; token?: string } = { t: "rjoin" };
      if (o.code !== undefined) { if (!isInviteCode(o.code)) return null; m.code = o.code; }
      if (o.token !== undefined) { if (typeof o.token !== "string" || !HEX32.test(o.token)) return null; m.token = o.token; }
      return m;
    }
    case "rinvite": case "rstart": case "rsolo": case "rleave": case "ragain":
      return { t: o.t };
    case "rring":
      return nonNegInt(o.i) ? { t: "rring", i: o.i } : null;
    default:
      return null;
  }
}

/**
 * A stamp's shape, or null: a race id of [A-Za-z0-9-] (so the `|`-joined
 * payload stays unambiguous), a 32-hex token, a ring index, a finite time and
 * a SIG_HEX signature. Used for server messages and for uploaded stamps.
 */
export function parseStamp(v: unknown): Stamp | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  if (typeof s.r !== "string" || !RACE_ID_RE.test(s.r) || typeof s.k !== "string" || !HEX32.test(s.k)
    || !nonNegInt(s.i) || !finite(s.at) || typeof s.sig !== "string" || !SIG_RE.test(s.sig)) return null;
  return { r: s.r, k: s.k, i: s.i, at: s.at, sig: s.sig };
}

/** A server's race message, or null for anything else (a live-sky `snap` included). */
export function parseRaceServer(raw: unknown): RaceServerMessage | null {
  const o = parseObject(raw);
  if (!o) return null;
  switch (o.t) {
    case "rlobby": {
      if (!str(o.race) || !KINDS.includes(o.kind as string) || !(o.code === null || isInviteCode(o.code))
        || typeof o.host !== "boolean" || typeof o.token !== "string" || !HEX32.test(o.token)
        || !Array.isArray(o.pilots) || !(o.startsAt === null || finite(o.startsAt)) || !finite(o.now)) return null;
      const pilots: LobbyPilot[] = [];
      for (const p of o.pilots) {
        const q = p as Record<string, unknown> | null;
        if (!q || typeof q !== "object" || !ccOrNull(q.cc) || typeof q.you !== "boolean") return null;
        pilots.push({ cc: q.cc, you: q.you });
      }
      return { t: "rlobby", race: o.race, kind: o.kind as RaceKind, code: o.code, host: o.host, token: o.token, pilots, startsAt: o.startsAt, now: o.now };
    }
    case "rgrid":
      return str(o.race) && KINDS.includes(o.kind as string) && nonNegInt(o.slot) && finite(o.goAt) && finite(o.now)
        ? { t: "rgrid", race: o.race, kind: o.kind as RaceKind, slot: o.slot, goAt: o.goAt, now: o.now } : null;
    case "rgo": {
      const stamp = parseStamp(o.stamp);
      return stamp && finite(o.now) ? { t: "rgo", stamp, now: o.now } : null;
    }
    case "rstamp": {
      const stamp = parseStamp(o.stamp);
      return stamp ? { t: "rstamp", stamp } : null;
    }
    case "rfinal":
      return finite(o.endsAt) && finite(o.now) ? { t: "rfinal", endsAt: o.endsAt, now: o.now } : null;
    case "rover":
      return str(o.race) && finite(o.uploadBy) && finite(o.now) ? { t: "rover", race: o.race, uploadBy: o.uploadBy, now: o.now } : null;
    case "rresults": {
      if (!str(o.race) || !Array.isArray(o.rows) || !finite(o.againBy) || !finite(o.now)) return null;
      const rows: ResultRow[] = [];
      for (const r of o.rows) {
        const q = r as Record<string, unknown> | null;
        if (!q || typeof q !== "object" || !nonNegInt(q.place) || !ccOrNull(q.cc) || !(q.timeMs === null || finite(q.timeMs))
          || !nonNegInt(q.rings) || typeof q.you !== "boolean") return null;
        rows.push({ place: q.place, cc: q.cc, timeMs: q.timeMs, rings: q.rings, you: q.you });
      }
      return { t: "rresults", race: o.race, rows, againBy: o.againBy, now: o.now };
    }
    case "rwait":
      return ccOrNull(o.cc) ? { t: "rwait", cc: o.cc } : null;
    case "rerr":
      return ERRORS.includes(o.reason as string) ? { t: "rerr", reason: o.reason as RaceError } : null;
    default:
      return null;
  }
}

// ---- stamps ----------------------------------------------------------------

export const stampPayload = (s: Omit<Stamp, "sig">): string => `${s.r}|${s.k}|${s.i}|${s.at}`;

/** Same approach as hmacHex in beacon-api/src/handler.ts (WebCrypto exists in Workers, browsers and Node 20+). */
const hmacKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

async function hmacHex(key: CryptoKey, text: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function equalConstTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let n = 0; n < a.length; n++) diff |= a.charCodeAt(n) ^ b.charCodeAt(n);
  return diff === 0;
}

export async function signStamp(secret: string, s: Omit<Stamp, "sig">): Promise<Stamp> {
  const sig = (await hmacHex(await hmacKey(secret), stampPayload(s))).slice(0, SIG_HEX);
  return { r: s.r, k: s.k, i: s.i, at: s.at, sig };
}

async function verifyWith(key: CryptoKey, s: Stamp): Promise<boolean> {
  if (typeof s.sig !== "string") return false;
  const want = (await hmacHex(key, stampPayload(s))).slice(0, SIG_HEX);
  return equalConstTime(want, s.sig);
}

export async function verifyStamp(secret: string, s: Stamp): Promise<boolean> {
  return verifyWith(await hmacKey(secret), s);
}

// ---- lap and path checks ---------------------------------------------------

/** Ring i's centre: the finish (i === centres.length) is ring 0 again. */
const gateOf = (centres: Centres, i: number) => centres[i % centres.length];
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The speed rule: ring `from` to ring `to` in `dtMs` is no faster than warp
 * allows (ring edge to ring edge, less SPEED_SLACK_S). checkLap applies it to
 * uploaded stamps and the race room before it signs one.
 */
export function legBelievable(centres: Centres, from: number, to: number, dtMs: number): boolean {
  const need = Math.max(0, dist(gateOf(centres, from), gateOf(centres, to)) - 2 * RING_RADIUS) / RACE_SPEED - SPEED_SLACK_S;
  const dt = dtMs / 1000;
  return dt >= 0 && dt >= need;
}

/**
 * Whether a racer's stamps are a believable lap: signed by us, for this race
 * and racer, in ring order from the start, never faster than warp allows.
 * A lap that stops short is a valid DNF; a lap that reaches the finish has a time.
 */
export async function checkLap(
  secret: string, race: string, token: string, stamps: readonly Stamp[], centres: Centres,
): Promise<LapCheck> {
  if (stamps.length === 0 || stamps[0].i !== 0) return { ok: false, reason: "start" };
  const finish = centres.length;
  // Cheap rejections before any signature work: a lap holds at most stamps 0..N.
  if (stamps.length > finish + 1) return { ok: false, reason: "order" };
  if (stamps.some((s) => s.r !== race || s.k !== token)) return { ok: false, reason: "race" };
  const key = await hmacKey(secret);
  for (const s of stamps) if (!(await verifyWith(key, s))) return { ok: false, reason: "sig" };
  for (let n = 0; n < stamps.length; n++) {
    if (stamps[n].i !== n || n > finish) return { ok: false, reason: "order" };
  }
  for (let n = 1; n < stamps.length; n++) {
    const a = stamps[n - 1], b = stamps[n];
    if (!legBelievable(centres, a.i, b.i, b.at - a.at)) return { ok: false, reason: "speed" };
  }
  const last = stamps[stamps.length - 1];
  return { ok: true, rings: last.i, timeMs: last.i === finish ? last.at - stamps[0].at : null, lastAt: last.at };
}

/**
 * Slack on a ghost's position at a ring stamp, beyond the ring's radius (u).
 * Server stamps arrive about one round trip after the client's crossing.
 */
export const PATH_RING_SLACK = 40;
/** Slack on the ghost's duration against the stamped lap time (s), for the same reason. */
export const PATH_TIME_SLACK_S = 1.5;

/**
 * Whether an uploaded best-lap ghost matches the stamped lap: no teleports, the
 * same duration, and through every ring (the GO stamp aside) when the server stamped it.
 * Expects a finished lap (stamps 0..N).
 */
export function checkPath(ghost: Ghost, stamps: readonly Stamp[], centres: Centres): boolean {
  if (stamps.length !== centres.length + 1) return false;
  const lapTime = (stamps[stamps.length - 1].at - stamps[0].at) / 1000;
  if (Math.abs(ghost.time - lapTime) > PATH_TIME_SLACK_S) return false;
  const s = ghost.samples;
  if (s.length < 2) return false;
  const maxStep = (RACE_SPEED / GHOST_HZ) * 1.5 + 0.5;
  for (let n = 1; n < s.length; n++) {
    if (Math.hypot(s[n].x - s[n - 1].x, s[n].y - s[n - 1].y, s[n].z - s[n - 1].z) > maxStep) return false;
  }
  for (const st of stamps) {
    // The GO stamp is issued at goAt wherever the ship sits on the grid (up to ~38 u behind gate 0).
    if (st.i === 0) continue;
    const t = (st.at - stamps[0].at) / 1000;
    // sampleGhost is null at the very end of the run: the last sample is the pose there.
    const p = sampleGhost(s, t) ?? s[s.length - 1];
    if (dist([p.x, p.y, p.z], gateOf(centres, st.i)) > RING_RADIUS + PATH_RING_SLACK) return false;
  }
  return true;
}

// ---- results ---------------------------------------------------------------

/** Finishers by time, then DNFs by rings flown (most first); ties by who got there first. */
export function rankResults(entries: readonly ResultEntry[]): ResultEntry[] {
  return [...entries].sort((a, b) => {
    if ((a.timeMs === null) !== (b.timeMs === null)) return a.timeMs === null ? 1 : -1;
    if (a.timeMs !== null && b.timeMs !== null && a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    if (a.timeMs === null && a.rings !== b.rings) return b.rings - a.rings;
    return a.lastAt - b.lastAt;
  });
}
