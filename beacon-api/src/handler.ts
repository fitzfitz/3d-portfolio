import { validateDrop, BEACON_LIMIT, type Beacon } from "../../src/utils/beacons";

/**
 * Beacon API request handling, free of Cloudflare bindings so it can be unit
 * tested (tests/beaconApi.test.ts). index.ts wires it to D1.
 *
 *   GET  /beacons   newest BEACON_LIMIT beacons
 *   POST /beacons   { x, y, z, phrase } → 201 { beacon }
 */

export interface StoredBeacon extends Beacon {
  /** SHA-256 of salt + client IP. The raw IP is never stored. */
  ipHash: string;
}

export interface BeaconStore {
  list(limit: number): Promise<StoredBeacon[]>;
  countSince(ipHash: string, since: number): Promise<number>;
  insert(row: StoredBeacon): Promise<void>;
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
/** Rows kept; older beacons fall off. The scene only shows BEACON_LIMIT anyway. */
export const KEEP_ROWS = 500;
const MAX_BODY_BYTES = 1024;

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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  // Browsers always send Origin on a cross-origin POST; refusing others keeps
  // casual scripts and other sites from writing into the sky.
  if (!origin || !deps.allowedOrigins.includes(origin)) return json(403, { error: "origin" }, {});

  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(413, { error: "too large" }, h);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json(400, { error: "bad json" }, h); }
  const v = validateDrop(body);
  if (!v.ok) return json(400, { error: "invalid beacon" }, h);

  const now = deps.now();
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await sha256Hex(`${deps.salt}:${ip}`);
  if (await deps.store.countSince(ipHash, now - RATE_WINDOW_MS + 1) > 0) {
    return json(429, { error: "rate" }, { ...h, "Retry-After": String(RATE_WINDOW_MS / 1000) });
  }

  // CF-IPCountry is "XX" when unknown and "T1" for Tor; keep real codes only.
  const cc = req.headers.get("CF-IPCountry");
  const country = cc && /^[A-Z]{2}$/.test(cc) && cc !== "XX" && cc !== "T1" ? cc : null;
  const row: StoredBeacon = { id: crypto.randomUUID(), ...v.drop, at: now, country, ipHash };
  await deps.store.insert(row);
  await deps.store.prune(KEEP_ROWS);
  return json(201, { beacon: publicView(row) }, h);
}
