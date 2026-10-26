import {
  validatePosition, BOTTLE_LIMIT, BOTTLE_DAILY_CAP, type Bottle, type BottleRateReason,
} from "../../src/utils/beacons";
import { checkBottleText } from "../../src/utils/bottleFilter";
import { BEACON_PHRASES } from "../../src/data/beaconPhrases";

/**
 * Messages-in-bottles API (the routes keep their beacon names), free of
 * Cloudflare bindings so it can be unit tested (tests/beaconApi.test.ts,
 * tests/bottleApi.test.ts). index.ts wires it to D1 through d1Store.ts.
 *
 *   GET  /beacons   newest BOTTLE_LIMIT visible bottles
 *   POST /beacons   { x, y, z, text } → 201 { beacon }
 *                   (or the legacy { x, y, z, phrase }, from a cached old client)
 *
 * GET /content (projects and career) lives in content.ts.
 */

export interface StoredBottle extends Bottle {
  /**
   * The BEACON_PHRASES index for a legacy drop, else null. Served back so the
   * old client, which only reads phrases, keeps showing those through the deploy.
   */
  phrase: number | null;
  /** HMAC-SHA256(IP_SALT, rate key). The raw IP is never stored. */
  ipHash: string;
}

/** The limits one insert is checked against; each `*Since` is an inclusive epoch-ms bound. */
export interface DropLimits {
  /** Refused if the pilot has any row at or after this (the RATE_WINDOW_MS window). */
  keySince: number;
  /** Refused if `globalMax` rows from anyone exist at or after `globalSince`. */
  globalSince: number;
  globalMax: number;
  /** Refused if the pilot has `dayMax` rows at or after `daySince`. */
  daySince: number;
  dayMax: number;
}

export interface BeaconStore {
  /** The newest `limit` rows that are not hidden. */
  list(limit: number): Promise<StoredBottle[]>;
  /**
   * Inserts `row` unless a limit in `limits` refuses it; hidden rows count.
   * Must be ONE atomic statement: a separate check and insert let a parallel
   * burst from one client all pass the check before any insert lands.
   */
  insertIfAllowed(row: StoredBottle, limits: DropLimits): Promise<boolean>;
  /**
   * The pilot's drop times at or after `since`, newest first, hidden rows
   * included. Read after a refused insert only to explain it, so it need not
   * be atomic with it.
   */
  pilotDrops(ipHash: string, since: number): Promise<number[]>;
  /** Deletes all but the newest `keep` rows, except that rows at or after `keepSince` always stay. */
  prune(keep: number, keepSince: number): Promise<void>;
}

/** The Workers Rate Limiting binding's interface (env.LIMITER). */
export interface RequestLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Deps {
  store: BeaconStore;
  /**
   * Per-pilot request budget across GET and POST. Guards the Worker and D1
   * quotas, which the drop limits can't: a GET loop never drops anything.
   * Optional so local runs and tests need no binding.
   */
  limiter?: RequestLimiter;
  allowedOrigins: readonly string[];
  salt: string;
  now: () => number;
}

/** One bottle per pilot per window. */
export const RATE_WINDOW_MS = 10 * 60_000;
/** The daily cap's window (BOTTLE_DAILY_CAP per pilot in any DAY_MS). */
export const DAY_MS = 24 * 3_600_000;
/**
 * Drops per minute across everyone. Bounds a flood from rotating IPs, and
 * bounds how fast the table grows (see KEEP_ROWS).
 */
export const GLOBAL_PER_MINUTE = 10;
/**
 * Rows kept once they are older than a day; older bottles fall off. The scene
 * only shows BOTTLE_LIMIT anyway.
 *
 * The per-pilot limits live in these rows, so a row must outlive every window
 * it is counted in. The 10-minute window was safe with a plain "newest 500":
 * at GLOBAL_PER_MINUTE the table turns over in 500 / 10 = 50 minutes. The
 * daily cap is not: at that rate a day writes 10 × 1,440 = 14,400 rows, so a
 * plain prune would forget a pilot's notes within the hour and reopen their
 * cap. prune() therefore never deletes a row younger than DAY_MS. The table
 * is then at most KEEP_ROWS + 14,400 rows (one day at the global cap), a few
 * MB, and back to KEEP_ROWS a day after the burst.
 */
export const KEEP_ROWS = 500;
/** Fits a full note: 140 code points of up to 4 UTF-8 bytes each, plus the coordinates. */
const MAX_BODY_BYTES = 1024;
export const MIN_SALT_LENGTH = 16;

/** CORS headers for `origin`; content.ts (GET /content) shares them. */
export function cors(origin: string | null, allowedOrigins: readonly string[]): Record<string, string> {
  // Vary on every response, not only allowed ones: GETs are publicly cacheable
  // for 30s, and a copy made for another (or no) Origin, carrying no CORS
  // headers, must never be served to the site.
  if (!origin || !allowedOrigins.includes(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * What the API serves: `{ id, x, y, z, text, at, country }`, plus `phrase`
 * for a legacy drop so the old client (which parses phrases only) still
 * shows it. The new client ignores `phrase`.
 */
function publicView(b: StoredBottle): Bottle & { phrase?: number } {
  const { id, x, y, z, text, at, country, phrase } = b;
  return phrase === null ? { id, x, y, z, text, at, country } : { id, x, y, z, text, at, country, phrase };
}

const isPhraseIndex = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < BEACON_PHRASES.length;

/**
 * Why a refused insert was refused, and when the pilot may try again. The
 * daily cap is named first: past it, the 10-minute wait is beside the point.
 */
function refusal(drops: readonly number[], limits: DropLimits, now: number): { reason: BottleRateReason; retryAt: number } {
  if (drops.length >= limits.dayMax) return { reason: "daily", retryAt: drops[limits.dayMax - 1] + DAY_MS };
  if (drops.length > 0 && drops[0] >= limits.keySince) return { reason: "wait", retryAt: drops[0] + RATE_WINDOW_MS };
  return { reason: "busy", retryAt: now + 60_000 };
}

/**
 * The part of a client address that identifies one pilot. IPv4 whole; IPv6 to
 * its /64, since a single home connection is handed 2^64 addresses and could
 * otherwise rotate past the limit at will.
 */
export function rateKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":");
}

export async function hmacHex(key: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Serves list() from memory for `ttlMs`. Cache-Control alone does not cache a
 * Worker's own responses, so without this every GET is a D1 read. Per
 * isolate, which is fine: a few-second-stale sky is invisible.
 */
export function withListCache(store: BeaconStore, ttlMs: number, now: () => number): BeaconStore {
  let cached: { at: number; limit: number; rows: StoredBottle[] } | null = null;
  return {
    async list(limit) {
      if (cached && cached.limit === limit && now() - cached.at < ttlMs) return cached.rows;
      const rows = await store.list(limit);
      cached = { at: now(), limit, rows };
      return rows;
    },
    async insertIfAllowed(...args) {
      const ok = await store.insertIfAllowed(...args);
      if (ok) cached = null;
      return ok;
    },
    pilotDrops: (ipHash, since) => store.pilotDrops(ipHash, since),
    prune: (keep, keepSince) => store.prune(keep, keepSince),
  };
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("Origin");
  const h = cors(origin, deps.allowedOrigins);
  if (url.pathname !== "/beacons") return json(404, { error: "not found" }, h);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  // The request budget runs first, for every method: it guards the Worker and
  // D1 quotas, so a POST spends it even when the filter then refuses the note.
  if (deps.limiter && !(await deps.limiter.limit({ key: rateKey(ip) })).success) {
    return json(429, { error: "slow down" }, { ...h, "Retry-After": "60" });
  }

  if (req.method === "GET") {
    const rows = await deps.store.list(BOTTLE_LIMIT);
    return json(200, { beacons: rows.map(publicView) }, { ...h, "Cache-Control": "public, max-age=30" });
  }

  if (req.method !== "POST") return json(405, { error: "method not allowed" }, h);
  // Not a security control — any non-browser client can send any Origin. It
  // stops other sites' pages from writing into this sky; the rate limits
  // below are what bound abuse.
  if (!origin || !deps.allowedOrigins.includes(origin)) return json(403, { error: "origin" }, {});
  // Fail closed: an unset salt would make every stored hash brute-forceable.
  if (deps.salt.length < MIN_SALT_LENGTH) return json(500, { error: "misconfigured" }, h);
  if (!(req.headers.get("Content-Type") ?? "").startsWith("application/json")) {
    return json(415, { error: "json only" }, h);
  }
  // Refuse a declared oversized body before buffering any of it.
  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "too large" }, h);

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: "too large" }, h);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "bad json" }, h); }

  // 1. Where: the same position rules as the client.
  const pos = validatePosition(body);
  if (!pos.ok) return json(400, { error: "invalid beacon" }, h);
  // 2. What: free text through the filter, or a legacy phrase index. The
  //    phrases are the owner's own fixed strings and skip the filter (one is
  //    over 20 characters of capitals, which it would call junk).
  const { text, phrase } = body as Record<string, unknown>;
  let note: { text: string; phrase: number | null };
  if (typeof text === "string") {
    const c = checkBottleText(text);
    if (!c.ok) return json(400, { error: "rejected", reason: c.reason }, h);
    note = { text: c.text, phrase: null };
  } else if (text === undefined && isPhraseIndex(phrase)) {
    note = { text: BEACON_PHRASES[phrase], phrase };
  } else {
    return json(400, { error: "invalid beacon" }, h);
  }

  const now = deps.now();
  const ipHash = await hmacHex(deps.salt, rateKey(ip));
  // CF-IPCountry is "XX" when unknown and "T1" for Tor; keep real codes only.
  const cc = req.headers.get("CF-IPCountry");
  const country = cc && /^[A-Z]{2}$/.test(cc) && cc !== "XX" && cc !== "T1" ? cc : null;
  const row: StoredBottle = { id: crypto.randomUUID(), ...pos.pos, ...note, at: now, country, ipHash };

  // 3. How often: the pilot's window, the global cap and the pilot's daily
  //    cap, in one atomic insert.
  const limits: DropLimits = {
    keySince: now - RATE_WINDOW_MS + 1,
    globalSince: now - 60_000 + 1,
    globalMax: GLOBAL_PER_MINUTE,
    daySince: now - DAY_MS + 1,
    dayMax: BOTTLE_DAILY_CAP,
  };
  if (!(await deps.store.insertIfAllowed(row, limits))) {
    const { reason, retryAt } = refusal(await deps.store.pilotDrops(ipHash, limits.daySince), limits, now);
    const retryAfter = Math.max(1, Math.ceil((retryAt - now) / 1000));
    // `error: "rate"` is what the old client keys on (it reads the status only).
    return json(429, { error: "rate", reason, retryAfter }, { ...h, "Retry-After": String(retryAfter) });
  }
  await deps.store.prune(KEEP_ROWS, limits.daySince);
  return json(201, { beacon: publicView(row) }, h);
}
