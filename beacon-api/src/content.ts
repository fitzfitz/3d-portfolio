import { cors, json, rateKey, type RequestLimiter } from "./handler";

/**
 * GET /content: the portfolio's projects and career, from the D1 tables in
 * beacon-api/content.sql (spec docs/superpowers/specs/2026-10-23-dynamic-content-design.md).
 * Read-only: the owner edits the rows in the Cloudflare D1 console. Rows go out
 * as stored (tech as JSON text, NULL for an absent optional field); the client
 * validates every row (src/utils/contentParse.ts). Free of Cloudflare
 * bindings so it can be unit tested (tests/contentApi.test.ts).
 */

export interface ContentRows {
  projects: Record<string, unknown>[];
  career: Record<string, unknown>[];
}

/** Both tables, each in `sort` order. */
export interface ContentStore {
  read(): Promise<ContentRows>;
}

export interface ContentDeps {
  store: ContentStore;
  /** The per-pilot request budget the beacon routes spend too (wrangler.toml [[ratelimits]]). */
  limiter?: RequestLimiter;
  allowedOrigins: readonly string[];
}

/** Browsers and Cloudflare's edge may reuse an answer this long: with the 60 s isolate cache, an edit shows within about six minutes. */
export const CONTENT_MAX_AGE_S = 300;
/** Per-isolate memory cache: Cache-Control alone does not cache a Worker's own responses (handler.ts withListCache). */
export const CONTENT_CACHE_MS = 60_000;

/** Serves read() from memory for `ttlMs`, so repeat page loads skip D1. A failed read is not kept. */
export function withContentCache(store: ContentStore, ttlMs: number, now: () => number): ContentStore {
  let cached: { at: number; rows: ContentRows } | null = null;
  return {
    async read() {
      if (cached && now() - cached.at < ttlMs) return cached.rows;
      const rows = await store.read();
      cached = { at: now(), rows };
      return rows;
    },
  };
}

export async function handleContent(req: Request, deps: ContentDeps): Promise<Response> {
  const h = cors(req.headers.get("Origin"), deps.allowedOrigins);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "GET") return json(405, { error: "method not allowed" }, h);

  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  if (deps.limiter && !(await deps.limiter.limit({ key: rateKey(ip) })).success) {
    return json(429, { error: "slow down" }, { ...h, "Retry-After": "60" });
  }

  let rows: ContentRows;
  try {
    rows = await deps.store.read();
  } catch {
    // Tables missing (schema not applied yet) or D1 down: the site falls back
    // to its bundled content. Never cached, so the fix shows at once.
    return json(503, { error: "content unavailable" }, { ...h, "Cache-Control": "no-store" });
  }
  return json(200, { projects: rows.projects, career: rows.career }, { ...h, "Cache-Control": `public, max-age=${CONTENT_MAX_AGE_S}` });
}
