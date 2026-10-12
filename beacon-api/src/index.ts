import { handleRequest, withListCache, type BeaconStore, type StoredBeacon } from "./handler";

/**
 * Cloudflare Worker entry: binds the handler to D1. Deploy steps are in
 * beacon-api/README.md.
 */

// The slice of the D1 API used here, declared locally so the repo needs no
// @cloudflare/workers-types dependency.
interface D1Result<T> { results: T[] }
interface D1RunResult { meta: { changes: number } }
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1RunResult>;
}
interface D1Database { prepare(sql: string): D1Stmt }

interface Env {
  DB: D1Database;
  /** Comma-separated origins allowed to read and drop, e.g. the Pages and Cloudflare hosts. */
  ALLOWED_ORIGINS: string;
  /** Secret (wrangler secret put IP_SALT), 16+ chars or POSTs fail closed. HMAC key for IP hashes; rotate to forget them. */
  IP_SALT: string;
}

interface Row { id: string; x: number; y: number; z: number; phrase: number; at: number; country: string | null; ip_hash: string }

function d1Store(db: D1Database): BeaconStore {
  const fromRow = (r: Row): StoredBeacon => ({
    id: r.id, x: r.x, y: r.y, z: r.z, phrase: r.phrase, at: r.at, country: r.country, ipHash: r.ip_hash,
  });
  return {
    async list(limit) {
      const { results } = await db.prepare("SELECT * FROM beacons ORDER BY at DESC LIMIT ?").bind(limit).all<Row>();
      return results.map(fromRow);
    },
    // One statement, so SQLite makes check-and-insert atomic: a parallel burst
    // cannot all pass the check before the first row lands.
    async insertIfAllowed(b, keySince, globalSince, globalMax) {
      const r = await db.prepare(
        `INSERT INTO beacons (id, x, y, z, phrase, at, country, ip_hash)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM beacons WHERE ip_hash = ? AND at >= ?)
           AND (SELECT COUNT(*) FROM beacons WHERE at >= ?) < ?`,
      ).bind(b.id, b.x, b.y, b.z, b.phrase, b.at, b.country, b.ipHash, b.ipHash, keySince, globalSince, globalMax).run();
      return r.meta.changes > 0;
    },
    // Walks the `at` index to the keep-th row instead of scanning a NOT IN set.
    async prune(keep) {
      await db.prepare("DELETE FROM beacons WHERE at < (SELECT at FROM beacons ORDER BY at DESC LIMIT 1 OFFSET ?)")
        .bind(keep - 1).run();
    },
  };
}

/** Per isolate: survives across requests, so repeat GETs skip D1 for 30s. */
let store: BeaconStore | null = null;

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    store ??= withListCache(d1Store(env.DB), 30_000, Date.now);
    return handleRequest(req, {
      store,
      allowedOrigins: env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
      salt: env.IP_SALT,
      now: () => Date.now(),
    });
  },
};
