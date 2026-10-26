import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { maybeStoreBest, readBestLap } from "../beacon-api/src/raceHttp";
import type { D1Database } from "../beacon-api/src/d1Store";
import { RACE_GATES, SEED_SPEED } from "../src/data/ringCourse";
import { decodeGhost, encodeGhost, seedLap } from "../src/utils/race";
import { RACE_COURSE_ID } from "../src/utils/raceProtocol";
import { sqliteD1 } from "./helpers/sqliteD1";
import { lapAt } from "./helpers/raceLap";

/*
 * The best lap in D1 (beacon-api/race.sql), over SQLite: the shipped SQL.
 * maybeStoreBest keeps one row per course, written only by a finished lap
 * that beats the row (or the seed lap with no row) and whose ghost decodes
 * and passes checkPath.
 */

const NOW = 1_760_000_000_000;
const SEED_MS = seedLap(RACE_GATES, SEED_SPEED).time * 1000;

let db: D1Database;
let sql: DatabaseSync;
const rows = () => sql.prepare("SELECT course, time_ms, ghost, cc, at FROM race_best").all() as
  { course: string; time_ms: number; ghost: string; cc: string | null; at: number }[];

beforeEach(() => {
  ({ db, sql } = sqliteD1("beacon-api/race.sql"));
});

describe("maybeStoreBest", () => {
  it("with no row, a lap slower than the seed lap is not stored", async () => {
    const lap = lapAt(SEED_SPEED - 3);
    expect(lap.entry.timeMs!).toBeGreaterThan(SEED_MS);
    expect(await maybeStoreBest(db, lap.entry, lap.stamps, encodeGhost(lap.ghost), "ID", NOW)).toBe(false);
    expect(rows()).toEqual([]);
  });
  it("with no row, a lap faster than the seed lap with a valid ghost is stored", async () => {
    const lap = lapAt(35);
    expect(lap.entry.timeMs!).toBeLessThan(SEED_MS);
    expect(await maybeStoreBest(db, lap.entry, lap.stamps, encodeGhost(lap.ghost), "ID", NOW)).toBe(true);
    const [row] = rows();
    expect(row).toMatchObject({ course: RACE_COURSE_ID, time_ms: lap.entry.timeMs, cc: "ID", at: NOW });
    expect(decodeGhost(row.ghost)?.samples).toHaveLength(lap.ghost.samples.length);
  });
  it("stores the ghost re-encoded, so extra fields a client sent are not served back", async () => {
    const lap = lapAt(35);
    const sent = JSON.stringify({ ...JSON.parse(encodeGhost(lap.ghost)), junk: "<script>" });
    expect(await maybeStoreBest(db, lap.entry, lap.stamps, sent, null, NOW)).toBe(true);
    expect(rows()[0].ghost).toBe(encodeGhost(decodeGhost(sent)!));
    expect(rows()[0].cc).toBeNull();
  });
  it("a faster lap whose ghost fails checkPath is not stored", async () => {
    const lap = lapAt(35);
    const off = { ...lap.ghost, samples: lap.ghost.samples.map((s) => ({ ...s, y: s.y + 100 })) };
    expect(await maybeStoreBest(db, lap.entry, lap.stamps, encodeGhost(off), "ID", NOW)).toBe(false);
    expect(rows()).toEqual([]);
  });
  it("a faster lap with no ghost, or one that does not decode, is not stored", async () => {
    const lap = lapAt(35);
    expect(await maybeStoreBest(db, lap.entry, lap.stamps, undefined, "ID", NOW)).toBe(false);
    expect(await maybeStoreBest(db, lap.entry, lap.stamps, "not a ghost", "ID", NOW)).toBe(false);
    expect(await maybeStoreBest(db, lap.entry, lap.stamps, '{"v":2,"time":1,"s":[]}', "ID", NOW)).toBe(false);
    expect(rows()).toEqual([]);
  });
  it("a DNF (no time) is never stored", async () => {
    const lap = lapAt(35);
    const dnf = { ...lap.entry, timeMs: null, rings: 4 };
    expect(await maybeStoreBest(db, dnf, lap.stamps, encodeGhost(lap.ghost), "ID", NOW)).toBe(false);
    expect(rows()).toEqual([]);
  });
  it("a later faster lap replaces the row; a slower one does not", async () => {
    const first = lapAt(35), faster = lapAt(37), slower = lapAt(36);
    expect(await maybeStoreBest(db, first.entry, first.stamps, encodeGhost(first.ghost), "ID", NOW)).toBe(true);
    expect(await maybeStoreBest(db, faster.entry, faster.stamps, encodeGhost(faster.ghost), "SG", NOW + 1)).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ time_ms: faster.entry.timeMs, cc: "SG", at: NOW + 1 });
    expect(await maybeStoreBest(db, slower.entry, slower.stamps, encodeGhost(slower.ghost), "MY", NOW + 2)).toBe(false);
    expect(rows()[0]).toMatchObject({ time_ms: faster.entry.timeMs, cc: "SG", at: NOW + 1 });
  });
  it("a tie with the row is not a new best", async () => {
    const lap = lapAt(35);
    expect(await maybeStoreBest(db, lap.entry, lap.stamps, encodeGhost(lap.ghost), "ID", NOW)).toBe(true);
    expect(await maybeStoreBest(db, lap.entry, lap.stamps, encodeGhost(lap.ghost), "SG", NOW + 1)).toBe(false);
    expect(rows()[0].cc).toBe("ID");
  });
});

describe("readBestLap", () => {
  it("is null with no row", async () => {
    expect(await readBestLap(db)).toBeNull();
  });
  it("reads the course's row as a BestLap", async () => {
    const lap = lapAt(35);
    await maybeStoreBest(db, lap.entry, lap.stamps, encodeGhost(lap.ghost), "ID", NOW);
    expect(await readBestLap(db)).toEqual({
      course: RACE_COURSE_ID, timeMs: lap.entry.timeMs, ghost: encodeGhost(lap.ghost), cc: "ID", at: NOW,
    });
  });
  it("ignores another course's row", async () => {
    sql.exec("INSERT INTO race_best (course, time_ms, ghost, cc, at) VALUES ('loop-1', 1000, '{}', NULL, 1)");
    expect(await readBestLap(db)).toBeNull();
  });
});

describe("schema.sql", () => {
  it("creates the same race_best table as race.sql", () => {
    const shape = (s: DatabaseSync) => s.prepare("SELECT name, type, \"notnull\", pk FROM pragma_table_info('race_best')").all();
    expect(shape(sqliteD1("beacon-api/schema.sql").sql)).toEqual(shape(sql));
  });
  it("race.sql is safe to run twice", () => {
    expect(() => sqliteD1("beacon-api/race.sql", "beacon-api/race.sql")).not.toThrow();
  });
});
