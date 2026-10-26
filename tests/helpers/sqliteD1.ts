import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1Database, D1Stmt } from "../../beacon-api/src/d1Store";

/**
 * A D1 stand-in over node:sqlite: the SQL engine D1 runs, in memory, so the
 * adapter's real statements (beacon-api/src/d1Store.ts) are what the tests
 * exercise. `files` are SQL scripts applied in order, e.g. the schema.
 */
export function sqliteD1(...files: string[]): { db: D1Database; sql: DatabaseSync } {
  const sql = new DatabaseSync(":memory:");
  for (const f of files) sql.exec(readFileSync(f, "utf8"));
  return { db: d1Of(sql), sql };
}

/** The D1 API over an open node:sqlite database. */
export function d1Of(sql: DatabaseSync): D1Database {
  return {
    prepare(query) {
      const make = (args: unknown[]): D1Stmt => ({
        bind: (...values) => make(values),
        all: async <T>() => ({ results: sql.prepare(query).all(...(args as SQLInputValue[])) as T[] }),
        run: async () => ({ meta: { changes: Number(sql.prepare(query).run(...(args as SQLInputValue[])).changes) } }),
      });
      return make([]);
    },
  };
}
