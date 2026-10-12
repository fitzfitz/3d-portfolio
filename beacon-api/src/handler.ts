import { validateDrop, BEACON_LIMIT, type Beacon } from "../../src/utils/beacons";

/**
 * Beacon API request handling, free of Cloudflare bindings so it can be unit
 * tested (tests/beaconApi.test.ts). index.ts wires it to D1.
 *
 *   GET  /beacons   newest BEACON_LIMIT beacons
 *   POST /beacons   { x, y, z, phrase } → 201 { beacon }
 */

export interface StoredBeacon extends Beacon {
  /** HMAC-SHA256(IP_SALT, rate key). The raw IP is never stored. */
  ipHash: string;
}

export interface BeaconStore {
  list(limit: number): Promise<StoredBeacon[]>;
  /**
   * Inserts `row` unless its ipHash already has a row at or after `keySince`,
   * or `globalMax` rows exist at or after `globalSince`. Must be ONE atomic
   * statement: a separate check and insert let a parallel burst from one
   * client all pass the check before any insert lands.
   */
  insertIfAllowed(row: StoredBeacon, keySince: number, globalSince: number, globalMax: number): Promise<boolean>;
  /** Deletes all but the newest `keep` rows. */
  prune(keep: number): Promise<void>;
}

export interface Deps {
  store: BeaconStore;
  allowedOrigins: readonly string[];
  salt: string;
  now: () => number;
}

/** One beacon per pilot per window. */
export const RATE_WINDOW_MS = 10 * 60_000;
/**
 * Drops per minute across everyone. Bounds a flood from rotating IPs, and
 * keeps the table (KEEP_ROWS) from turning over inside RATE_WINDOW_MS — the
 * per-pilot limit lives in those rows, so pruning them early would forget it.
 */
export const GLOBAL_PER_MINUTE = 10;
/** Rows kept; older beacons fall off. The scene only shows BEACON_LIMIT anyway. */
export const KEEP_ROWS = 500;
const MAX_BODY_BYTES = 1024;
const MIN_SALT_LENGTH = 16;

function cors(origin: string | null, deps: Deps): Record<string, string> {
  if (!origin || !deps.allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const publicView = ({ ipHash: _ipHash, ...b }: StoredBeacon): Beacon => b;

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

async function hmacHex(key: string, text: string): Promise<string> {
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
  let cached: { at: number; limit: number; rows: StoredBeacon[] } | null = null;
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
    prune: (keep) => store.prune(keep),
  };
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("Origin");
  const h = cors(origin, deps);
  if (url.pathname !== "/beacons") return json(404, { error: "not found" }, h);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

  if (req.method === "GET") {
    const rows = await deps.store.list(BEACON_LIMIT);
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

  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(413, { error: "too large" }, h);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json(400, { error: "bad json" }, h); }
  const v = validateDrop(body);
  if (!v.ok) return json(400, { error: "invalid beacon" }, h);

  const now = deps.now();
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await hmacHex(deps.salt, rateKey(ip));
  // CF-IPCountry is "XX" when unknown and "T1" for Tor; keep real codes only.
  const cc = req.headers.get("CF-IPCountry");
  const country = cc && /^[A-Z]{2}$/.test(cc) && cc !== "XX" && cc !== "T1" ? cc : null;
  const row: StoredBeacon = { id: crypto.randomUUID(), ...v.drop, at: now, country, ipHash };

  const inserted = await deps.store.insertIfAllowed(row, now - RATE_WINDOW_MS + 1, now - 60_000 + 1, GLOBAL_PER_MINUTE);
  if (!inserted) return json(429, { error: "rate" }, { ...h, "Retry-After": "60" });
  await deps.store.prune(KEEP_ROWS);
  return json(201, { beacon: publicView(row) }, h);
}
