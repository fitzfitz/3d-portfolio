import { handleRequest, type BeaconStore, type StoredBeacon } from "./handler";

/**
 * Cloudflare Worker entry: binds the handler to D1. Deploy steps are in
 * beacon-api/README.md.
 */

// The slice of the D1 API used here, declared locally so the repo needs no
// @cloudflare/workers-types dependency.
interface D1Result<T> { results: T[] }
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Database { prepare(sql: string): D1Stmt }

interface Env {
  DB: D1Database;
  /** Comma-separated origins allowed to read and drop, e.g. the Pages and Cloudflare hosts. */
  ALLOWED_ORIGINS: string;
  /** Secret (wrangler secret put IP_SALT). Salts IP hashes; rotate to forget them. */
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
    async countSince(ipHash, since) {
      const r = await db.prepare("SELECT COUNT(*) AS n FROM beacons WHERE ip_hash = ? AND at >= ?")
        .bind(ipHash, since).first<{ n: number }>();
      return r?.n ?? 0;
    },
    async insert(b) {
      await db.prepare("INSERT INTO beacons (id, x, y, z, phrase, at, country, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(b.id, b.x, b.y, b.z, b.phrase, b.at, b.country, b.ipHash).run();
    },
    async prune(keep) {
      await db.prepare("DELETE FROM beacons WHERE id NOT IN (SELECT id FROM beacons ORDER BY at DESC LIMIT ?)")
        .bind(keep).run();
    },
  };
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, {
      store: d1Store(env.DB),
      allowedOrigins: env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
      salt: env.IP_SALT,
      now: () => Date.now(),
    });
  },
};
