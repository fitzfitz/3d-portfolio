import { BEACON_PHRASES } from "../../src/data/beaconPhrases";
import type { BeaconStore, StoredBottle } from "./handler";

/**
 * The beacons table (schema.sql, migrated by bottles.sql) behind the
 * BeaconStore contract. Separate from index.ts so tests can run these exact
 * statements over SQLite (tests/bottleApi.test.ts).
 */

// The slice of the D1 API used here, declared locally so the repo needs no
// @cloudflare/workers-types dependency.
export interface D1Result<T> { results: T[] }
export interface D1RunResult { meta: { changes: number } }
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1RunResult>;
}
export interface D1Database { prepare(sql: string): D1Stmt }

interface Row {
  id: string; x: number; y: number; z: number;
  phrase: number; text: string | null; at: number; country: string | null; ip_hash: string;
}

/**
 * `phrase` is NOT NULL in the production table (SQLite cannot relax that
 * without rebuilding it), so a free-text bottle stores -1, which the old
 * client's parser rejects: it never shows text it cannot render.
 */
const NO_PHRASE = -1;

/**
 * A row's text. A row the old Worker wrote between the migration and the new
 * deploy has a phrase but no text, so map it here as bottles.sql does.
 */
function rowText(r: Row): string | null {
  return r.text ?? (r.phrase >= 0 ? BEACON_PHRASES[r.phrase] ?? null : null);
}

export function d1Store(db: D1Database): BeaconStore {
  return {
    async list(limit) {
      const { results } = await db.prepare(
        `SELECT id, x, y, z, phrase, text, at, country, ip_hash FROM beacons
         WHERE hidden = 0 ORDER BY at DESC LIMIT ?`,
      ).bind(limit).all<Row>();
      const out: StoredBottle[] = [];
      for (const r of results) {
        const text = rowText(r);
        if (text === null) continue;
        out.push({
          id: r.id, x: r.x, y: r.y, z: r.z, text, phrase: r.phrase >= 0 ? r.phrase : null,
          at: r.at, country: r.country, ipHash: r.ip_hash,
        });
      }
      return out;
    },
    // One statement, so SQLite makes check-and-insert atomic: a parallel burst
    // cannot all pass the checks before the first row lands. The three checks
    // are the pilot's window, the global per-minute cap and the pilot's daily
    // cap; hidden rows count toward all of them.
    async insertIfAllowed(b, l) {
      const r = await db.prepare(
        `INSERT INTO beacons (id, x, y, z, phrase, text, at, country, ip_hash)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM beacons WHERE ip_hash = ? AND at >= ?)
           AND (SELECT COUNT(*) FROM beacons WHERE at >= ?) < ?
           AND (SELECT COUNT(*) FROM beacons WHERE ip_hash = ? AND at >= ?) < ?`,
      ).bind(
        b.id, b.x, b.y, b.z, b.phrase ?? NO_PHRASE, b.text, b.at, b.country, b.ipHash,
        b.ipHash, l.keySince,
        l.globalSince, l.globalMax,
        b.ipHash, l.daySince, l.dayMax,
      ).run();
      return r.meta.changes > 0;
    },
    async pilotDrops(ipHash, since) {
      const { results } = await db.prepare("SELECT at FROM beacons WHERE ip_hash = ? AND at >= ? ORDER BY at DESC")
        .bind(ipHash, since).all<{ at: number }>();
      return results.map((r) => r.at);
    },
    // Walks the `at` index to the keep-th row instead of scanning a NOT IN set,
    // and never deletes a row at or after keepSince (see KEEP_ROWS in handler.ts).
    async prune(keep, keepSince) {
      await db.prepare(
        "DELETE FROM beacons WHERE at < ? AND at < (SELECT at FROM beacons ORDER BY at DESC LIMIT 1 OFFSET ?)",
      ).bind(keepSince, keep - 1).run();
    },
  };
}
