import { cors, json, rateKey, type RequestLimiter } from "./handler";
import type { D1Database } from "./d1Store";
import type { UploadResult } from "./raceRoom";
import {
  MIN_RACE_SECRET, RACE_COURSE_ID, UPLOAD_MAX_BYTES, checkPath, parseStamp, type ResultEntry, type Stamp,
} from "../../src/utils/raceProtocol";
import { decodeGhost, encodeGhost, seedLap } from "../../src/utils/race";
import { RACE_CENTRES, RACE_GATES, SEED_SPEED } from "../../src/data/ringCourse";

/**
 * The ring race's HTTP side, free of Cloudflare bindings so it can be unit
 * tested (tests/raceHttp.test.ts, tests/raceBest.test.ts). index.ts wires it
 * to D1 and the Sky Durable Object.
 *
 *   GET  /race/best     { course, timeMs, ghost, cc, at }, or { course, timeMs: null }
 *   POST /race/result   { race, token, stamps, ghost? } → the Sky room's reply:
 *                       200 { ok: true, entry }, or 400 | 404 | 409 { ok: false, reason }
 *                       (503 with no usable RACE_SECRET)
 *
 * The best lap is one D1 row per course (race.sql), written by the Sky room
 * after a finished upload (maybeStoreBest).
 */

export interface BestLap { course: string; timeMs: number; ghost: string; cc: string | null; at: number }
export interface RaceHttpDeps {
  /** The same per-pilot budget as /beacons (env.LIMITER); optional so tests need no binding. */
  limiter?: RequestLimiter;
  allowedOrigins: string[];
  /** raceSecret(env.RACE_SECRET): null turns uploads away with 503. */
  secret: string | null;
  readBest(): Promise<BestLap | null>;
  /** Hands the raw upload body to the Sky room (POST https://sky/race/result). */
  forwardResult(body: string): Promise<Response>;
}

/** The race secret, or null when it is missing or shorter than MIN_RACE_SECRET: racing then fails closed. */
export function raceSecret(raw: string | undefined): string | null {
  return typeof raw === "string" && raw.length >= MIN_RACE_SECRET ? raw : null;
}

/** null = not a race route (the Worker carries on to its other routes). */
export async function handleRaceHttp(req: Request, deps: RaceHttpDeps): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (path !== "/race/best" && path !== "/race/result") return null;
  const origin = req.headers.get("Origin");
  const h = cors(origin, deps.allowedOrigins);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  const want = path === "/race/best" ? "GET" : "POST";
  if (req.method !== want) return json(405, { error: "method not allowed" }, h);

  // The request budget first, for both routes, as for /beacons.
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  if (deps.limiter && !(await deps.limiter.limit({ key: rateKey(ip) })).success) {
    return json(429, { error: "slow down" }, { ...h, "Retry-After": "60" });
  }

  if (path === "/race/best") {
    let best: BestLap | null;
    try {
      best = await deps.readBest();
    } catch {
      // Table missing (race.sql not applied yet) or D1 down: the site races the seed lap.
      return json(503, { error: "unavailable" }, { ...h, "Cache-Control": "no-store" });
    }
    return json(200, best ?? { course: RACE_COURSE_ID, timeMs: null }, { ...h, "Cache-Control": "public, max-age=30" });
  }

  // As for /beacons: stops other sites' pages from uploading, not a script.
  if (!origin || !deps.allowedOrigins.includes(origin)) return json(403, { error: "origin" }, {});
  if (deps.secret === null) return json(503, { error: "racing is off" }, h);
  // Refuse a declared oversized body before buffering any of it.
  if (Number(req.headers.get("Content-Length") ?? "0") > UPLOAD_MAX_BYTES) return json(413, { error: "too large" }, h);
  const raw = await req.text();
  if (raw.length > UPLOAD_MAX_BYTES || new TextEncoder().encode(raw).length > UPLOAD_MAX_BYTES) {
    return json(413, { error: "too large" }, h);
  }
  const res = await deps.forwardResult(raw);
  let body: unknown;
  try { body = await res.json(); } catch { body = { ok: false, reason: "unavailable" }; }
  return json(res.status, body, h);
}

/**
 * Serves readBest from memory for `ttlMs`, per isolate, like withListCache
 * (handler.ts). A new best can be up to `ttlMs` late; a failed read is not cached.
 */
export function withBestCache(read: () => Promise<BestLap | null>, ttlMs: number, now: () => number): () => Promise<BestLap | null> {
  let cached: { at: number; best: BestLap | null } | null = null;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.best;
    const best = await read();
    cached = { at: now(), best };
    return best;
  };
}

/** The course's best lap in D1 (race.sql), or null with no row. */
export async function readBestLap(db: D1Database): Promise<BestLap | null> {
  const { results } = await db.prepare("SELECT course, time_ms, ghost, cc, at FROM race_best WHERE course = ?")
    .bind(RACE_COURSE_ID).all<{ course: string; time_ms: number; ghost: string; cc: string | null; at: number }>();
  const r = results[0];
  return r ? { course: r.course, timeMs: r.time_ms, ghost: r.ghost, cc: r.cc, at: r.at } : null;
}

/** The time to beat with no row: the seed lap both the server and the site race (ms). */
let seedMs: number | null = null;
const seedLapMs = () => (seedMs ??= seedLap(RACE_GATES, SEED_SPEED).time * 1000);

/**
 * Stores a finished lap as the course's best when it beats the row (or the
 * seed lap with no row), its ghost decodes and the ghost passes checkPath
 * against the lap's (already checked) stamps. The ghost is stored re-encoded,
 * so only the fields encodeGhost writes are ever served back. True when stored.
 */
export async function maybeStoreBest(
  db: D1Database, entry: ResultEntry, stamps: Stamp[], ghost: string | undefined, cc: string | null, now: number,
): Promise<boolean> {
  if (entry.timeMs === null || ghost === undefined) return false;
  const path = decodeGhost(ghost);
  if (!path || !checkPath(path, stamps, RACE_CENTRES)) return false;
  const { results } = await db.prepare("SELECT time_ms FROM race_best WHERE course = ?")
    .bind(RACE_COURSE_ID).all<{ time_ms: number }>();
  const bar = results[0]?.time_ms ?? seedLapMs();
  if (!(entry.timeMs < bar)) return false;
  // One statement: the upsert only replaces a slower row, whatever ran in between.
  const r = await db.prepare(
    `INSERT INTO race_best (course, time_ms, ghost, cc, at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (course) DO UPDATE SET time_ms = excluded.time_ms, ghost = excluded.ghost, cc = excluded.cc, at = excluded.at
     WHERE excluded.time_ms < race_best.time_ms`,
  ).bind(RACE_COURSE_ID, entry.timeMs, encodeGhost(path), cc, now).run();
  return r.meta.changes > 0;
}

/**
 * The Sky room's reply to an upload. Never the race (it holds every racer's
 * token): `{ ok, reason? }`, plus the entry without its token on a 200.
 */
export function uploadReply(res: UploadResult): Response {
  if (res.status !== 200 || !res.entry) return json(res.status, { ok: false, reason: res.reason }, {});
  const { cc, timeMs, rings, lastAt } = res.entry;
  return json(200, { ok: true, entry: { cc, timeMs, rings, lastAt } }, {});
}

/**
 * What maybeStoreBest needs from a 200 upload with a finished entry: the
 * entry, the body's stamps (onRaceUpload has checked them), its ghost, and
 * the racer's country. Null for a refusal or a DNF.
 */
export function bestCandidate(body: unknown, res: UploadResult):
  { entry: ResultEntry; stamps: Stamp[]; ghost: string | undefined; cc: string | null } | null {
  if (res.status !== 200 || !res.entry || res.entry.timeMs === null || !res.race) return null;
  const o = body as { stamps?: unknown; ghost?: unknown };
  if (!Array.isArray(o.stamps)) return null;
  const stamps: Stamp[] = [];
  for (const v of o.stamps) {
    const s = parseStamp(v);
    if (!s) return null;
    stamps.push(s);
  }
  const token = res.entry.token;
  const cc = res.race.racers.find((r) => r.token === token)?.cc ?? null;
  return { entry: res.entry, stamps, ghost: typeof o.ghost === "string" ? o.ghost : undefined, cc };
}
